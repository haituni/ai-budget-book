"""程序入口：初始化数据库，把界面交给 pywebview 原生窗口渲染。

界面 HTML/CSS/JS 在启动时由 Python 读入并内联注入，
因此不会启动任何本地 HTTP 服务，全程只有一个进程。

窗口外壳按 macOS 的做法自绘：去掉系统标题栏，由界面自己画出红/黄/绿
三个窗口按钮和工具栏，拖动区域用 .pywebview-drag-region 标记。
万一自绘外壳在某台机器上不工作（例如远程桌面里的老 WebView2），
设置环境变量 LEDGER_NATIVE_FRAME=1 就能退回系统原生标题栏。
"""

from __future__ import annotations

import os
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

# 自绘标题栏时窗口的最小尺寸：再小下去工具栏就会挤在一起
MIN_WINDOW_SIZE = (860, 600)


def uses_custom_titlebar() -> bool:
    """是否使用自绘的 macOS 风格标题栏（LEDGER_NATIVE_FRAME=1 可关闭）。"""
    raw = os.environ.get("LEDGER_NATIVE_FRAME", "").strip().lower()
    return raw not in {"1", "true", "yes", "on"}


def build_html() -> str:
    """把 html/css/js 合成单文档，避免 pywebview 起本地文件服务。"""
    html = (UI_DIR / "index.html").read_text(encoding="utf-8")
    css = (UI_DIR / "styles.css").read_text(encoding="utf-8")
    js = "\n\n".join(
        (UI_DIR / "js" / name).read_text(encoding="utf-8") for name in JS_PARTS
    )
    return html.replace("/*__STYLES__*/", css).replace("/*__APP_JS__*/", js)


def create_main_window(api: Api, frameless: bool):
    """建主窗口。frameless=True 时界面自绘标题栏。"""
    return webview.create_window(
        "月度账本",
        html=build_html(),
        js_api=api,
        width=1240,
        height=840,
        min_size=MIN_WINDOW_SIZE,
        text_select=True,
        frameless=frameless,
        # 只让界面上标记过的区域可以拖动窗口，这样表格里的文字照常框选
        easy_drag=False,
        background_color="#F0F0F2",
    )


def main() -> None:
    # 启动前先存一份备份，万一之后误删/误改还能找回
    backup_db()
    db_path = init_db()
    api = Api()

    # 界面用 <header class="titlebar pywebview-drag-region"> 指定可拖动区域
    # （这本来就是 pywebview 的默认值，写清楚只是为了以后不会被改掉）
    try:
        webview.settings["DRAG_REGION_SELECTOR"] = ".pywebview-drag-region"
    except Exception:  # noqa: BLE001 - 设置项不可写时沿用默认值即可
        pass

    frameless = uses_custom_titlebar()
    if frameless:
        try:
            window = create_main_window(api, frameless=True)
        except Exception as exc:  # noqa: BLE001 - 自绘外壳失败就退回原生标题栏
            print(f"自绘标题栏不可用（{exc}），改用系统标题栏启动。")
            window = create_main_window(api, frameless=False)
    else:
        window = create_main_window(api, frameless=False)

    api._window = window
    webview.start()
    print(f"数据文件：{db_path}")


if __name__ == "__main__":
    main()
