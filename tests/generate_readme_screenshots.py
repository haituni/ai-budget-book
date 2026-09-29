"""Generate README screenshots from an isolated, disposable demo database.

BUDGET_DB_PATH is set before importing any project module, so this script
cannot read or write dataset/budget.db.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
EDGE_CANDIDATES = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


def find_edge() -> Path:
    for candidate in EDGE_CANDIDATES:
        if candidate.exists():
            return candidate
    found = shutil.which("msedge")
    if found:
        return Path(found)
    raise RuntimeError("未找到 Microsoft Edge，无法生成 README 截图")


def seed_demo_data() -> dict[str, object]:
    from core import ai, intelligence, memory, repo, service
    from core.db import init_db

    init_db()

    wanted = {
        "伙食费": (1200, "essential"),
        "通勤": (300, "essential"),
        "学习用品": (450, "occasional"),
        "日用品": (250, "flexible"),
        "社交": (400, "flexible"),
        "医疗": (200, "essential"),
        "零食奶茶": (180, "flexible"),
        "其他": (120, "unknown"),
    }

    for category in repo.list_categories():
        if category["name"] not in wanted and not category["is_system"]:
            repo.delete_category(category["id"])

    by_name = {item["name"]: item for item in repo.list_categories()}
    for name, (budget, spending_type) in wanted.items():
        item = by_name[name]
        repo.update_category(item["id"], name, budget, spending_type)

    by_name = {item["name"]: item for item in repo.list_categories()}
    ids = {name: item["id"] for name, item in by_name.items()}
    repo.set_month_budget(ids["社交"], "2026-09", 350)

    rows = [
        ("伙食费", "2026-06-05", 168, "校园卡充值"),
        ("通勤", "2026-06-12", 92, "地铁与公交"),
        ("学习用品", "2026-06-18", 138, "参考书"),
        ("社交", "2026-06-25", 260, "同学聚餐"),
        ("伙食费", "2026-07-06", 186, "校园卡充值"),
        ("通勤", "2026-07-11", 108, "地铁与公交"),
        ("日用品", "2026-07-16", 89, "洗护用品"),
        ("社交", "2026-07-24", 310, "聚餐"),
        ("伙食费", "2026-08-03", 220, "校园卡充值"),
        ("学习用品", "2026-08-09", 156, "论文打印"),
        ("通勤", "2026-08-15", 126, "地铁与公交"),
        ("医疗", "2026-08-21", 86, "常用药"),
        ("社交", "2026-08-26", 288, "同学聚餐"),
        ("伙食费", "2026-09-02", 18, "食堂午饭"),
        ("伙食费", "2026-09-04", 16.5, "食堂晚饭"),
        ("通勤", "2026-09-06", 22, "晚间打车"),
        ("学习用品", "2026-09-08", 86, "论文打印与装订"),
        ("社交", "2026-09-12", 128, "同学聚餐"),
        ("零食奶茶", "2026-09-15", 19, "奶茶"),
        ("日用品", "2026-09-18", 56.8, "洗衣液"),
        ("伙食费", "2026-09-20", 36, "超市采购"),
        ("社交", "2026-09-24", 168, "聚餐"),
        ("通勤", "2026-09-26", 6, "地铁"),
        ("伙食费", "2026-09-27", 22.5, "食堂午饭"),
        ("零食奶茶", "2026-09-28", 13, "咖啡"),
    ]
    repo.add_expenses_batch(
        [
            {
                "category_id": ids[category],
                "spent_on": spent_on,
                "amount": amount,
                "note": note,
            }
            for category, spent_on, amount, note in rows
        ]
    )

    # No API key: analyze_month deterministically saves a local report.
    ai.analyze_month("2026-09")

    return {
        "bootstrap": service.bootstrap(),
        "list_categories": repo.list_categories(),
        "category_memories": memory.category_memories(),
        "list_days": repo.list_days(),
        "overview": service.month_overview("2026-09"),
        "intelligence": intelligence.month_intelligence("2026-09"),
        "history": service.month_history("2026-09", 6),
        "list_expenses": repo.list_expenses("2026-09"),
        "ai_config": ai.get_config(),
        "list_ai_reports": ai.list_reports("2026-09", 20),
    }


DARK_MEDIA = "@media (prefers-color-scheme: dark)"


def build_page(payloads: dict[str, object], view: str, theme: str = "light") -> str:
    ui_dir = ROOT / "ui"
    html = (ui_dir / "index.html").read_text(encoding="utf-8")
    css = (ui_dir / "styles.css").read_text(encoding="utf-8")
    css += "\n*{animation:none!important;transition:none!important;}"
    # 界面跟随系统深浅色。截图要两套都稳定产出，所以直接把那条媒体查询
    # 钉死：浅色时让它永不命中，深色时让它无条件命中，与跑脚本的机器无关。
    css = css.replace(
        DARK_MEDIA,
        "@media (min-width: 0px)" if theme == "dark" else "@media (min-width: 99999px)",
    )
    js = "\n\n".join(
        (ui_dir / "js" / name).read_text(encoding="utf-8")
        for name in ("00-util.js", "10-render.js", "20-forms.js", "30-boot.js")
    )
    # 桌面版是自绘标题栏：真机上是 pywebview 的 window_shell 接口告诉前端，
    # 截图里没有后端，所以这里补一份，不然截图会缺红黄绿按钮和工具栏。
    payloads = {
        **payloads,
        "window_shell": {
            "chrome": True,
            "zoomed": False,
            "min_width": 860,
            "min_height": 600,
        },
    }
    mock = (
        "const payloads=" + json.dumps(payloads, ensure_ascii=False) + ";"
        "window.pywebview={api:new Proxy({}, {get:function(_,name){"
        "return async function(){return {ok:true,data:(payloads[name]===undefined?null:payloads[name])};};"
        "}})};"
    )
    if view == "manual":
        action = "switchView('records');openExpenseModal(null);"
    else:
        action = "switchView(" + json.dumps(view) + ");"
    after_boot = (
        "setTimeout(function(){" + action
        # 无头截图里窗口拿不到焦点，红黄绿会画成灰点；README 要的是"正在用"的样子
        + "document.body.classList.remove('window-blurred');"
        + "document.documentElement.scrollTop=0;document.body.scrollTop=0;},900);"
    )
    return html.replace("/*__STYLES__*/", css).replace(
        "/*__APP_JS__*/", mock + js + after_boot
    )


def capture(edge: Path, html_path: Path, output_path: Path, profile_dir: Path) -> None:
    temporary_shot = html_path.with_suffix(".png")
    cmd = [
        str(edge),
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-gpu-compositing",
        "--in-process-gpu",
        "--use-gl=swiftshader",
        "--enable-unsafe-swiftshader",
        "--disable-extensions",
        "--disable-background-networking",
        "--disable-breakpad",
        "--hide-scrollbars",
        "--no-first-run",
        "--disable-features=msEdgeFirstRunExperience",
        f"--user-data-dir={profile_dir}",
        "--window-size=1440,1000",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=3500",
        f"--screenshot={temporary_shot}",
        html_path.as_uri(),
    ]
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=45,
    )
    if result.returncode != 0 or not temporary_shot.exists():
        raise RuntimeError(
            f"截图失败：{output_path.name}\n{result.stdout}\n{result.stderr}"
        )
    shutil.copyfile(temporary_shot, output_path)


def main() -> None:
    DOCS.mkdir(parents=True, exist_ok=True)
    edge = find_edge()
    with tempfile.TemporaryDirectory(prefix="monthly-ledger-readme-") as temp_name:
        temp_dir = Path(temp_name)
        demo_db = temp_dir / "readme-demo.db"
        os.environ["BUDGET_DB_PATH"] = str(demo_db)

        payloads = seed_demo_data()
        shots = {
            "overview": "新版-概览",
            "records": "新版-账单",
            "manual": "新版-手动记账",
            "manage": "新版-预算",
            "ai": "新版-洞察",
            "data": "新版-设置",
        }
        # 每个页面出两套：浅色给 README 的浅色主题，深色给深色主题
        for view, stem in shots.items():
            for theme, suffix in (("light", ""), ("dark", "-dark")):
                html_path = temp_dir / f"{view}-{theme}.html"
                html_path.write_text(
                    build_page(payloads, view, theme), encoding="utf-8"
                )
                capture(
                    edge,
                    html_path,
                    DOCS / f"{stem}{suffix}.png",
                    temp_dir / f"edge-{view}-{theme}",
                )
                print(f"generated docs/{stem}{suffix}.png")

        print(f"demo database was isolated at: {demo_db}")
        print("temporary database and browser profiles have been removed")


if __name__ == "__main__":
    main()
