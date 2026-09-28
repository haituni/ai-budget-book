"""数据库连接与表结构。

全部数据保存在程序目录下的 ./dataset/budget.db —— 一个真实的 SQLite 文件，
可以直接复制备份，也可以用其它 sqlite 工具打开查看。
"""

from __future__ import annotations

import sqlite3
import re
import os
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

# 源码运行时使用项目根目录；打包后使用 exe 所在目录。
# 这样数据库始终可写，也不会落进 PyInstaller 的临时资源目录。
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys.executable).resolve().parent
else:
    BASE_DIR = Path(__file__).resolve().parent.parent

# 允许用环境变量 BUDGET_DB_PATH 指向另一个数据库文件。
# 开发与自检脚本必须通过它指向临时文件，避免误动真实数据。
_env_db = os.environ.get("BUDGET_DB_PATH")
if _env_db:
    DB_PATH = Path(_env_db).expanduser().resolve()
    DATA_DIR = DB_PATH.parent
else:
    DATA_DIR = BASE_DIR / "dataset"
    DB_PATH = DATA_DIR / "budget.db"

BACKUP_DIR = DATA_DIR / "backups"
MAX_BACKUPS = 30

# 系统默认分类：不可删除、不可改名。删除其它分类时，历史流水会转入这里。
DEFAULT_CATEGORY_NAME = "其他"

# 首次运行时的示例分类（可自由编辑/删除，不是硬编码限制）。
SEED_CATEGORIES = [
    "伙食费",
    "水电",
    "网费",
    "话费",
    "通勤",
    "学习用品",
    "日用品",
    "社交",
    "衣物",
    "医疗",
    "零食奶茶",
    "意外备用金",
]

DEFAULT_SETTINGS = {
    # 预警阈值：已花 / 本月预算 达到该比例即提示「接近上限」，默认 80%
    "alert_threshold": "0.8",
    # AI 分析（OpenAI 兼容接口）。api_key 是 DPAPI 加密后的密文，明文不落库。
    "ai_enabled": "1",
    "ai_base_url": "https://api.deepseek.com/v1",
    "ai_model": "deepseek-chat",
    "ai_api_key": "",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL UNIQUE,
    monthly_budget REAL    NOT NULL DEFAULT 0 CHECK (monthly_budget >= 0),
    spending_type  TEXT    NOT NULL DEFAULT 'unknown'
                           CHECK (spending_type IN ('unknown', 'essential', 'flexible', 'occasional')),
    is_system      INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT    NOT NULL
);

-- 某个分类在某个具体月份单独覆盖的预算（不写这张表就沿用分类的默认月度预算）
CREATE TABLE IF NOT EXISTS budget_overrides (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    month       TEXT    NOT NULL,
    amount      REAL    NOT NULL CHECK (amount >= 0),
    -- user = 用户手动为该月单独设置；auto = 月份结束后由程序自动归档的快照
    source      TEXT    NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'auto')),
    created_at  TEXT    NOT NULL,
    UNIQUE (category_id, month)
);

-- 已经归档的月份：这些月份的预算已固定，之后改默认预算不会改写它们的历史数字
CREATE TABLE IF NOT EXISTS frozen_months (
    month      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    month       TEXT    NOT NULL,
    spent_on    TEXT    NOT NULL,
    amount      REAL    NOT NULL CHECK (amount > 0),
    note        TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_expenses_month    ON expenses(month);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_spent_on ON expenses(spent_on);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- AI 分析生成的历史报告（只存文本与当时的数据摘要，便于回看）
CREATE TABLE IF NOT EXISTS ai_reports (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    month      TEXT    NOT NULL,
    -- current = 分析的是当月（进行中，带前瞻建议）；past = 分析的是已过去的月份
    scope      TEXT    NOT NULL DEFAULT 'current' CHECK (scope IN ('current', 'past')),
    model      TEXT    NOT NULL DEFAULT '',
    content    TEXT    NOT NULL,
    -- 生成这份报告时该月的汇总数字（JSON 文本），列表里显示用
    stats      TEXT    NOT NULL DEFAULT '',
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_reports_month ON ai_reports(month, id);

-- 用户确认或拒绝过的自动分类建议，用于后续本地学习
CREATE TABLE IF NOT EXISTS classification_feedback (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    note_key              TEXT    NOT NULL,
    suggested_category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    chosen_category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    accepted              INTEGER NOT NULL CHECK (accepted IN (0, 1)),
    created_at            TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_classification_feedback_note
ON classification_feedback(note_key, id);

-- 智能提醒反馈：dismissed 的同一条提醒不再展示，useful 会保留并提高排序
CREATE TABLE IF NOT EXISTS insight_feedback (
    fingerprint    TEXT PRIMARY KEY,
    decision       TEXT    NOT NULL CHECK (decision IN ('useful', 'dismissed')),
    feedback_count INTEGER NOT NULL DEFAULT 1,
    updated_at     TEXT    NOT NULL
);
"""


def now_str() -> str:
    """当前本地时间，格式 YYYY-MM-DD HH:MM:SS。"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


# 严格格式：Python 的 strptime 会放过 '2026-9'，这里必须自己挡住，
# 否则会写进格式不统一的月份，导致按月查询查不到数据。
_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def ensure_data_dir() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)


@contextmanager
def connect():
    """每次调用开一条新连接（pywebview 的接口调用来自不同线程，这样最省心）。"""
    ensure_data_dir()
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def month_of(date_str: str) -> str:
    """'2026-09-27' -> '2026-09'"""
    return date_str[:7]


def parse_month(month: str) -> str:
    """校验并规范化 YYYY-MM 形式的月份字符串。"""
    text = (month or "").strip()
    if not _MONTH_RE.match(text):
        raise ValueError(f"月份格式不正确：{month!r}，应形如 2026-09")
    return text


def parse_date(date_str: str) -> str:
    """校验并规范化 YYYY-MM-DD 形式的日期字符串。"""
    text = (date_str or "").strip()
    if not _DATE_RE.match(text):
        raise ValueError(f"日期格式不正确：{date_str!r}，应形如 2026-09-27")
    try:
        datetime.strptime(text, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"这一天不存在：{date_str!r}") from exc
    return text


def get_setting(key: str, default: str | None = None) -> str | None:
    with connect() as con:
        row = con.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with connect() as con:
        con.execute(
            "INSERT INTO settings(key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def _migrate(con: sqlite3.Connection) -> None:
    """老版本数据库的原地升级（只加列，不动已有数据）。"""
    columns = {row["name"] for row in con.execute("PRAGMA table_info(budget_overrides)")}
    if "source" not in columns:
        # 老库里已有的行都是用户手动设置的该月预算
        con.execute(
            "ALTER TABLE budget_overrides ADD COLUMN source TEXT NOT NULL DEFAULT 'user'"
        )
    category_columns = {row["name"] for row in con.execute("PRAGMA table_info(categories)")}
    if "spending_type" not in category_columns:
        con.execute(
            "ALTER TABLE categories ADD COLUMN spending_type TEXT NOT NULL DEFAULT 'unknown'"
        )


def frozen_months(con: sqlite3.Connection) -> list[str]:
    """已经归档（预算已固定）的月份，升序。"""
    rows = con.execute("SELECT month FROM frozen_months ORDER BY month").fetchall()
    return [row["month"] for row in rows]


def freeze_past_months(con: sqlite3.Connection, today: str | None = None) -> list[str]:
    """把已经结束、且有流水的月份归档，返回本次新归档的月份。

    归档做的事：把这些月份里每个分类当月生效的预算写成本月独立预算。
    这样之后再改分类的默认月度预算，这些月份已经显示过的「预算 / 剩余 / 超支」
    就不会跟着变。当前月份永远不归档，仍然实时跟随默认预算。
    """
    current = parse_month(today) if today else datetime.now().strftime("%Y-%m")
    candidates = con.execute(
        "SELECT DISTINCT month FROM expenses WHERE month < ? ORDER BY month",
        (current,),
    ).fetchall()
    done = set(frozen_months(con))
    todo = [row["month"] for row in candidates if row["month"] not in done]
    if not todo:
        return []

    stamp = now_str()
    categories = con.execute("SELECT id, monthly_budget FROM categories").fetchall()
    for month in todo:
        for category in categories:
            # 已经有该月独立预算的（用户手设的）保持不动
            con.execute(
                "INSERT OR IGNORE INTO budget_overrides"
                "(category_id, month, amount, source, created_at) "
                "VALUES (?, ?, ?, 'auto', ?)",
                (int(category["id"]), month, float(category["monthly_budget"]), stamp),
            )
        con.execute(
            "INSERT OR IGNORE INTO frozen_months(month, created_at) VALUES (?, ?)",
            (month, stamp),
        )
    return todo


def _seed(con: sqlite3.Connection) -> None:
    """首次运行时建好系统默认分类、示例分类和默认设置。"""
    stamp = now_str()
    is_fresh = con.execute("SELECT COUNT(*) AS c FROM categories").fetchone()["c"] == 0

    has_default = con.execute(
        "SELECT id FROM categories WHERE is_system = 1 LIMIT 1"
    ).fetchone()
    if has_default is None:
        con.execute(
            "INSERT INTO categories(name, monthly_budget, is_system, sort_order, created_at) "
            "VALUES (?, 0, 1, 9000, ?)",
            (DEFAULT_CATEGORY_NAME, stamp),
        )

    if is_fresh:
        for index, name in enumerate(SEED_CATEGORIES, start=1):
            con.execute(
                "INSERT INTO categories(name, monthly_budget, is_system, sort_order, created_at) "
                "VALUES (?, 0, 0, ?, ?)",
                (name, index * 10, stamp),
            )

    for key, value in DEFAULT_SETTINGS.items():
        con.execute(
            "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value)
        )


def init_db() -> Path:
    """建表 + 补齐默认数据，返回数据库文件路径。"""
    ensure_data_dir()
    with connect() as con:
        con.execute("PRAGMA journal_mode = WAL")
        con.executescript(SCHEMA)
        _migrate(con)
        _seed(con)
        # 已经过去的月份先归档，之后改默认预算就不会反改历史
        freeze_past_months(con)
    return DB_PATH


def _copy_database(source: Path, target: Path) -> None:
    """用 SQLite 的在线备份 API 做一致性快照。

    不能直接复制文件：库跑在 WAL 模式下，已提交但还没 checkpoint 的数据
    留在 -wal 里，直接拷主库文件会少掉最近的记录。
    """
    src = sqlite3.connect(source, timeout=15)
    try:
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def backup_db() -> Path | None:
    """启动时把数据库复制一份到 dataset/backups/，只保留最近 MAX_BACKUPS 份。

    库里还没有任何用户数据时不备份，避免堆一堆空文件。
    """
    if not DB_PATH.exists():
        return None
    try:
        with connect() as con:
            has_data = (
                con.execute("SELECT COUNT(*) AS c FROM expenses").fetchone()["c"] > 0
                or con.execute(
                    "SELECT COUNT(*) AS c FROM categories WHERE is_system = 0"
                ).fetchone()["c"]
                > 0
            )
    except sqlite3.Error:
        return None
    if not has_data:
        return None

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"budget_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
    _copy_database(DB_PATH, target)

    for stale in sorted(BACKUP_DIR.glob("budget_*.db"))[:-MAX_BACKUPS]:
        stale.unlink()
    return target
