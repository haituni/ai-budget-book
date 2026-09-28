"""程序入口：初始化数据库，把界面交给 pywebview 原生窗口渲染。

界面 HTML/CSS/JS 在启动时由 Python 读入并内联注入，
因此不会启动任何本地 HTTP 服务，全程只有一个进程。
"""

from __future__ import annotations

import sys
from pathlib import Path

import webview

# 源码运行时资源就在项目目录；PyInstaller 打包后资源会解压到 _MEIPASS。
SOURCE_DIR = Path(__file__).resolve().parent
RESOURCE_DIR = Path(getattr(sys, "_MEIPASS", SOURCE_DIR))
if str(SOURCE_DIR) not in sys.path:
    sys.path.insert(0, str(SOURCE_DIR))

from core.api import Api  # noqa: E402
from core.db import backup_db, init_db  # noqa: E402

UI_DIR = RESOURCE_DIR / "ui"

# 前端脚本按文件名顺序拼装成一段脚本注入页面
JS_PARTS = [
    "00-util.js",
    "10-render.js",
    "20-forms.js",
    "30-boot.js",
]


def build_html() -> str:
    """把 html/css/js 合成单文档，避免 pywebview 起本地文件服务。"""
    html = (UI_DIR / "index.html").read_text(encoding="utf-8")
    css = (UI_DIR / "styles.css").read_text(encoding="utf-8")
    js = "\n\n".join(
        (UI_DIR / "js" / name).read_text(encoding="utf-8") for name in JS_PARTS
    )
    return html.replace("/*__STYLES__*/", css).replace("/*__APP_JS__*/", js)


def main() -> None:
    # 启动前先存一份备份，万一之后误删/误改还能找回
    backup_db()
    db_path = init_db()
    api = Api()
    window = webview.create_window(
        "月度账本",
        html=build_html(),
        js_api=api,
        width=1240,
        height=840,
        min_size=(820, 620),
        text_select=True,
    )
    api._window = window
    webview.start()
    print(f"数据文件：{db_path}")


if __name__ == "__main__":
    main()
