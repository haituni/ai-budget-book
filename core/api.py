"""暴露给前端的接口层。

前端通过 pywebview 的原生消息通道调用这里的方法（不走任何 HTTP 端口）。
每个方法统一返回 {"ok": true, "data": ...} 或 {"ok": false, "error": "..."}。
"""

from __future__ import annotations

import functools
import os
import subprocess
import sys
from pathlib import Path

try:  # pywebview 只有桌面端才有；Android 版由原生桥直接调用下面这些方法
    import webview
    from webview.window import FixPoint
except ImportError:  # pragma: no cover - Android 上没有 pywebview
    webview = None  # type: ignore[assignment]
    FixPoint = None  # type: ignore[assignment]

from . import ai, assistant, intelligence as intelligence_engine, memory, repo, service
from .db import BASE_DIR, DATA_DIR, DB_PATH

EXPORT_DIR = DATA_DIR / "exports"

# 自绘标题栏时窗口的最小尺寸，和 app.py 里的 min_size 保持一致
MIN_WINDOW_WIDTH = 860
MIN_WINDOW_HEIGHT = 600

# 安卓端由 android_entry.py 设置 LEDGER_ANDROID=1；这里给桌面端保持原行为。
IS_ANDROID = bool(os.environ.get("LEDGER_ANDROID")) or (
    sys.platform == "linux" and "ANDROID_ROOT" in os.environ
)


def _safe(func):
    """把异常转成前端能读懂的失败结果，避免整个界面卡死。"""

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return {"ok": True, "data": func(*args, **kwargs)}
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}
        except Exception as exc:  # noqa: BLE001 - 兜底，保证前端总有反馈
            return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}

    return wrapper


class Api:
    """pywebview 的 js_api 对象。"""

    def __init__(self) -> None:
        # 注意：必须是下划线开头的私有属性。pywebview 会把 js_api 对象上所有
        # 公开属性当成要暴露给前端的接口去序列化，若这里存的是 Window 对象，
        # 它会递归遍历整个窗口对象并刷屏报错。
        self._window = None  # 由 app.py 注入
        self._zoomed = False  # 自绘标题栏用：当前是否处于「缩放」（最大化）状态
        self._resize = None  # 自绘标题栏用：正在拖拽边缘时记下的初始几何

    def _require_window(self):
        """取桌面窗口，取不到就直接报错给前端（Android 上没有窗口）。"""
        if self._window is None:
            raise ValueError("当前环境没有可控制的桌面窗口")
        return self._window

    # -------------------------------------------- 窗口外壳（macOS 风格标题栏）
    #
    # 自绘标题栏之后，系统不再提供红黄绿按钮，也没有系统级的边缘拖拽改大小，
    # 所以这些操作统一由前端转发到这里，再交给 pywebview 执行。

    @_safe
    def window_shell(self):
        """告诉前端窗口外壳的形态：自绘标题栏 / 系统标题栏 / 没有窗口。"""
        win = self._window
        if win is None:
            return {"chrome": False, "zoomed": False}
        return {
            "chrome": bool(getattr(win, "frameless", False)),
            "zoomed": bool(self._zoomed),
            "min_width": MIN_WINDOW_WIDTH,
            "min_height": MIN_WINDOW_HEIGHT,
        }

    @_safe
    def window_minimize(self):
        self._require_window().minimize()
        return True

    @_safe
    def window_zoom(self):
        """红黄绿里的「缩放」：在最大化和还原之间切换。"""
        win = self._require_window()
        if self._zoomed:
            win.restore()
        else:
            win.maximize()
        self._zoomed = not self._zoomed
        return {"zoomed": self._zoomed}

    @_safe
    def window_close(self):
        self._require_window().destroy()
        return True

    @_safe
    def window_resize_start(self, edge):
        """开始拖拽窗口边缘。edge 由 n/s/e/w 组合而成，例如 se、n、w。"""
        win = self._require_window()
        edge = str(edge or "").strip().lower()
        if not edge or any(char not in "nsew" for char in edge):
            raise ValueError("未知的窗口缩放方向")
        self._zoomed = False
        self._resize = {
            "edge": edge,
            "width": float(win.width),
            "height": float(win.height),
            "x": float(win.x),
            "y": float(win.y),
        }
        return True

    @_safe
    def window_resize_to(self, dx, dy):
        """拖拽过程中不断调用：按鼠标位移算出新尺寸并应用。"""
        info = self._resize
        if not info:
            raise ValueError("没有正在进行的窗口缩放")
        win = self._require_window()
        try:
            dx = float(dx or 0)
            dy = float(dy or 0)
        except (TypeError, ValueError) as exc:
            raise ValueError("位移必须是数字") from exc

        edge = info["edge"]
        width = info["width"]
        height = info["height"]
        if "e" in edge:
            width += dx
        if "w" in edge:
            width -= dx
        if "s" in edge:
            height += dy
        if "n" in edge:
            height -= dy

        # 往左/往上放大时，别把窗口推出屏幕
        if "w" in edge:
            width = min(width, info["width"] + info["x"])
        if "n" in edge:
            height = min(height, info["height"] + info["y"])

        width = max(MIN_WINDOW_WIDTH, width)
        height = max(MIN_WINDOW_HEIGHT, height)

        # fix_point 决定哪条边保持不动：拖左边就钉住右边，拖上边就钉住下边
        fix = FixPoint.NORTH | FixPoint.WEST
        if "w" in edge and "n" in edge:
            fix = FixPoint.SOUTH | FixPoint.EAST
        elif "w" in edge:
            fix = FixPoint.NORTH | FixPoint.EAST
        elif "n" in edge:
            fix = FixPoint.SOUTH | FixPoint.WEST

        win.resize(int(round(width)), int(round(height)), fix)
        return {"width": int(round(width)), "height": int(round(height))}

    @_safe
    def window_resize_end(self):
        self._resize = None
        return True

    # ------------------------------------------------------------ 基础数据

    @_safe
    def bootstrap(self):
        return service.bootstrap()

    @_safe
    def list_categories(self):
        return repo.list_categories()

    @_safe
    def category_memories(self):
        return memory.category_memories()

    @_safe
    def suggest_category(self, note, amount=None):
        return memory.suggest_category(note, amount)

    @_safe
    def feedback_insight(self, payload):
        payload = payload or {}
        return memory.record_insight_feedback(
            payload.get("fingerprint"), payload.get("decision")
        )

    @_safe
    def parse_expense_text(self, text, default_date):
        return assistant.parse_expense_text(text, default_date)

    @_safe
    def ask_ledger(self, question, month):
        return assistant.answer_ledger(question, month)

    @_safe
    def budget_draft(self, target_month, history_limit=6):
        return assistant.budget_draft(target_month, history_limit)

    @_safe
    def apply_budget_draft(self, payload):
        payload = payload or {}
        return assistant.apply_budget_draft(
            payload.get("target_month"), payload.get("items") or []
        )

    # ------------------------------------------------------------ 月度统计

    @_safe
    def overview(self, month):
        return service.month_overview(month)

    @_safe
    def history(self, before_month, limit=6):
        """所选月份之前的往月支出回顾。"""
        return service.month_history(before_month, limit)

    @_safe
    def intelligence(self, month):
        """本地计算的消费特征、异常与分类级月底预测。"""
        return intelligence_engine.month_intelligence(month)

    @_safe
    def backtest_intelligence(self, limit=6):
        """用已经结束的月份检验预测误差。"""
        return intelligence_engine.backtest_forecasts(limit)

    @_safe
    def threshold(self):
        return service.alert_threshold()

    @_safe
    def set_threshold(self, percent):
        return service.set_alert_threshold(percent)

    # ------------------------------------------------------------ AI 分析

    @_safe
    def ai_config(self):
        """AI 接口配置（含是否已保存 Key，但不返回明文）。"""
        return ai.get_config()

    @_safe
    def save_ai_config(self, payload):
        payload = payload or {}
        return ai.save_config(payload)

    @_safe
    def test_ai_config(self, payload=None):
        """用表单里填的（或已保存的）配置做一次连通性测试。"""
        return ai.test_connection(payload)

    @_safe
    def analyze_month(self, month):
        """让大模型分析某个月的消费情况，并把报告存库。"""
        return ai.analyze_month(month)

    @_safe
    def list_ai_reports(self, month=None, limit=20):
        return ai.list_reports(month, limit)

    @_safe
    def delete_ai_report(self, report_id):
        ai.delete_report(report_id)
        return True

    # ------------------------------------------------------------ 预算管理

    @_safe
    def add_category(self, payload):
        payload = payload or {}
        new_id = repo.add_category(
            payload.get("name"), payload.get("budget", 0), payload.get("spending_type")
        )
        return {"id": new_id}

    @_safe
    def update_category(self, payload):
        payload = payload or {}
        repo.update_category(
            payload.get("id"), payload.get("name"), payload.get("budget", 0),
            payload.get("spending_type"),
        )
        return True

    @_safe
    def delete_category(self, category_id):
        return repo.delete_category(category_id)

    @_safe
    def set_month_budget(self, payload):
        """给某分类在某月设置单独预算；amount 为空则取消覆盖、改回默认预算。"""
        payload = payload or {}
        category_id = payload.get("category_id")
        month = payload.get("month")
        amount = payload.get("amount")
        if amount in (None, ""):
            repo.clear_month_budget(category_id, month)
            return {"cleared": True}
        repo.set_month_budget(category_id, month, amount)
        return {"cleared": False}

    # ------------------------------------------------------------ 消费流水

    @_safe
    def list_expenses(self, month=None, category_id=None, day=None):
        return repo.list_expenses(month=month, category_id=category_id, day=day)

    @_safe
    def list_days(self, month=None):
        """有消费记录的日期列表，供「按日」筛选快速选取。"""
        return repo.list_days(month=month or None)

    @_safe
    def add_expense(self, payload):
        payload = payload or {}
        new_id = repo.add_expense(
            payload.get("category_id"),
            payload.get("spent_on"),
            payload.get("amount"),
            payload.get("note", ""),
        )
        memory.record_classification_feedback(
            payload.get("note"), payload.get("suggested_category_id"),
            payload.get("category_id"),
        )
        return {"id": new_id}

    @_safe
    def add_expenses_batch(self, payload):
        payload = payload or {}
        items = payload.get("items") or []
        ids = repo.add_expenses_batch(items)
        for item in items:
            memory.record_classification_feedback(
                item.get("note"), item.get("suggested_category_id"),
                item.get("category_id"),
            )
        return {"ids": ids, "count": len(ids)}

    @_safe
    def update_expense(self, payload):
        payload = payload or {}
        repo.update_expense(
            payload.get("id"),
            payload.get("category_id"),
            payload.get("spent_on"),
            payload.get("amount"),
            payload.get("note", ""),
        )
        memory.record_classification_feedback(
            payload.get("note"), payload.get("suggested_category_id"),
            payload.get("category_id"),
        )
        return True

    @_safe
    def delete_expense(self, expense_id):
        repo.delete_expense(expense_id)
        return True

    # ------------------------------------------------------------ 导出 / 杂项

    @_safe
    def export_csv(self, month=None, category_id=None, day=None):
        """导出 CSV。优先弹保存对话框，用户取消或弹窗失败则存到 dataset/exports/。"""
        filename, text = service.build_csv(
            month=month, category_id=category_id, day=day
        )
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        fallback = EXPORT_DIR / filename
        target = None

        if self._window is not None:
            try:
                chosen = self._window.create_file_dialog(
                    webview.SAVE_DIALOG,
                    directory=str(EXPORT_DIR),
                    save_filename=filename,
                    file_types=("CSV 文件 (*.csv)",),
                )
            except Exception:  # noqa: BLE001 - 对话框不可用时静默降级
                chosen = None
            if chosen:
                target = Path(chosen[0] if isinstance(chosen, (list, tuple)) else chosen)
            else:
                # 用户主动取消
                return {"cancelled": True}

        path = target or fallback
        if path.suffix.lower() != ".csv":
            path = path.with_suffix(".csv")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8-sig", newline="")
        return {"path": str(path), "cancelled": False}

    @_safe
    def open_data_folder(self):
        """在资源管理器中打开数据目录。Android 上没有资源管理器，直接返回路径。"""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if IS_ANDROID:
            # 前端会拿到这个路径，原生层再把它备份/导出到「下载」目录
            return str(DATA_DIR)
        if sys.platform == "win32":
            os.startfile(str(DATA_DIR))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(DATA_DIR)])
        else:
            subprocess.Popen(["xdg-open", str(DATA_DIR)])
        return str(DATA_DIR)

    @_safe
    def app_info(self):
        return {
            "base_dir": str(BASE_DIR),
            "db_path": str(DB_PATH),
            "export_dir": str(EXPORT_DIR),
        }
