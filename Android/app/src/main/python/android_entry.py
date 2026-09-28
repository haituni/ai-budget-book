"""安卓端入口：把桌面版的 core 包接到 WebView 的原生桥上。

Java 侧（MainActivity）在启动时调用 setup()，之后每次前端调用都会走
call_json(method, args_json)，返回值是 {"ok": true, "data": ...} 的 JSON 字符串，
与桌面版 pywebview 的 js_api 完全一致，所以 ui/ 下的前端代码不需要改。
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import traceback
from datetime import datetime
from pathlib import Path

_LOCK = threading.Lock()
_API = None
_READY = False


def setup(files_dir: str) -> str:
    """安卓启动时调用：确定数据目录、建库、备份。

    必须在任何 core.* 模块被导入之前设置环境变量，因为 core/db.py 在
    导入时就固定了 DB_PATH。
    """
    global _READY
    os.environ["LEDGER_ANDROID"] = "1"
    data_dir = Path(files_dir) / "dataset"
    data_dir.mkdir(parents=True, exist_ok=True)
    db_path = data_dir / "budget.db"
    os.environ["BUDGET_DB_PATH"] = str(db_path)

    with _LOCK:
        if not _READY:
            from core.db import backup_db, init_db

            # 启动前留一份备份，误删误改还能找回（桌面版同款行为）
            backup_db()
            init_db()
            _READY = True
    return str(db_path)


def _get_api():
    global _API
    if _API is None:
        with _LOCK:
            if _API is None:
                from core.api import Api

                _API = Api()
    return _API


def call_json(method: str, args_json: str) -> str:
    """前端调用的唯一入口，返回 JSON 文本（永远是合法 JSON）。"""
    try:
        api = _get_api()
        func = getattr(api, str(method), None)
        if not callable(func) or str(method).startswith("_"):
            return _dump({"ok": False, "error": f"未知接口：{method}"})
        args = json.loads(args_json) if args_json else []
        if not isinstance(args, list):
            args = [args]
        return _dump(func(*args))
    except Exception as exc:  # noqa: BLE001 - 任何异常都要能回到前端
        traceback.print_exc()
        return _dump({"ok": False, "error": f"{type(exc).__name__}: {exc}"})


def snapshot_db() -> str:
    """用 SQLite 的在线备份接口生成一致性快照，返回快照文件路径。"""
    from core.db import BACKUP_DIR, DB_PATH

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"budget-{datetime.now():%Y%m%d-%H%M%S}.db"
    source = sqlite3.connect(str(DB_PATH))
    try:
        dest = sqlite3.connect(str(target))
        try:
            with dest:
                source.backup(dest)
        finally:
            dest.close()
    finally:
        source.close()
    return str(target)


def app_paths() -> str:
    """给排查用：返回当前数据目录等路径。"""
    from core.db import BACKUP_DIR, DATA_DIR, DB_PATH

    return _dump(
        {
            "data_dir": str(DATA_DIR),
            "db_path": str(DB_PATH),
            "backup_dir": str(BACKUP_DIR),
        }
    )


def _dump(payload) -> str:
    return json.dumps(payload, ensure_ascii=False)
