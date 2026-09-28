# 月度账本 · Android 版

桌面版本体是 `Python(pywebview) + HTML/CSS/JS`。这里没有重写界面，而是用
[Chaquopy](https://chaquo.com/chaquopy/) 把**同一份 Python 后端**编译进 APK，
再用一个全屏 `WebView` 加载**同一份 HTML/CSS/JS**，两者之间补一层原生桥。
因此 `ui/` 下的前端代码一行都没改。

## 产出

| 文件 | 说明 |
| --- | --- |
| `月度账本-1.0.apk`（本目录下） | 安装包副本，放在最外层方便直接看到/传给手机 |
| `dist/MonthlyLedger-1.0-release.apk` | 已签名（APK Signature Scheme v2，RSA 2048），日常装机用这个 |
| `dist/MonthlyLedger-1.0-debug.apk` | 调试包，方便 `adb` 覆盖安装 / `chrome://inspect` 抓 WebView |
| `screenshots/phone-*.png` | PC 上 390×844 手机视口渲染的 5 个页面 |
| `screenshots/device-*.png` | MuMu 模拟器上的实机截图（概览 / 账单 / 设置 / 导出提示） |

## 架构对照

| 环节 | 桌面版 | Android 版 |
| --- | --- | --- |
| 界面 | `ui/index.html` + `styles.css` + `js/*` | 同一份资源（构建时同步到 `app/src/main/assets/ui`） |
| 手机界面 | — | `assets/android/mobile.css` + `mobile.js`：一套独立的 iOS 风格设计层 |
| 前后端通信 | pywebview 的 `js_api` + `window.pywebview.api` | `assets/android/bridge.js` 用 Proxy 复刻出同名 API，经 `@JavascriptInterface` 转到 Chaquopy |
| 后端 | `core/` 包 | 同一份代码（随 APK 编译成 `core/*.pyc`） |
| 数据文件 | `dataset/budget.db` | 应用私有目录 `/data/data/com.cost.ledger/files/dataset/budget.db` |
| 导出 CSV | 弹保存对话框 | 写入应用私有目录后由原生层复制到系统「下载」目录 |
| 「打开数据文件夹」 | 打开资源管理器 | 导出数据库快照到「下载」目录（手机上没有资源管理器可开） |
| API Key 加密 | Windows DPAPI | 退化为 base64（安卓没有 DPAPI；数据仍只在应用私有目录内） |

对根目录源码的改动只有两处平台兼容，桌面行为不变：

- `core/api.py`：`import webview` 改为可选导入，并识别安卓环境
- `core/ai.py`：`ctypes` 改为可选导入（只为 Windows DPAPI 服务）

另外修掉了一个桌面端也存在、但只在矮窗口/手机上才暴露的样式 bug：
`.modal` 以前没有高度约束，内容一超高就既不滚动也被裁掉，底部按钮还会盖住内容。
现在弹窗是 flex 列、`.modal-body` 是唯一滚动区域（见 `ui/styles.css`），
AI 记账解析完还会自动把生成的账单滚进可视区。

## 手机端界面（iOS 风格设计层）

桌面版是「侧栏 + 面板仪表盘」，直接缩小到手机上会有很多别扭的地方，
所以安卓端单独做了一层设计，**只在 APK 内注入，桌面版一行都不受影响**：

| 位置 | 桌面版 | 手机版 |
| --- | --- | --- |
| 导航 | 左侧栏 | 底部标签栏：线性图标 + 文字、毛玻璃、安全区适配 |
| 顶部 | 页标题 + 一排按钮 | iOS 大标题（滚动自动收起）+ 右上角圆形「＋」 |
| 记一笔 | 顶部两个按钮 | 「＋」弹出操作表（AI 记账 / 手动填写），外层点了就收起 |
| 内容 | 面板堆叠 | 分组卡片 + 内嵌分隔线的列表，KPI 收成一行四张 |
| 账单/预算 | 表格 | 改写成「一笔一卡」列表：备注当标题、金额右对齐、操作收成文字按钮 |
| 设置 | 信息两列表格 | iOS 分组列表：左标签右值 |
| 弹窗 | 居中对话框 | 底部抽屉：抓手条、大圆角、底部大按钮 |
| 字体/颜色 | 品牌蓝 + 灰阶 | 系统字体栈 + iOS 系统色（#0a84ff / #34c759 / #ff9500 / #ff3b30） |
| 触感 | — | 切标签、开操作表时走原生桥轻震动 |

手机辨识断点取 `max-width: 900px`，所以横屏模拟器（853×480）同样走这套界面；
矮屏（`max-height: 620px`）另有一套压缩规则，KPI 收到一行四张。

## 构建

本机原本没有 Java / Android SDK / Gradle，脚本会自动把工具链下载到
`Android/toolchain`（约 500MB，国内镜像优先），不污染系统环境。

```powershell
# 首次：下载 JDK 17 + Android SDK + Gradle（已完成，可跳过）
powershell -ExecutionPolicy Bypass -File Android\tools\fetch-toolchain.ps1

# 构建（会先同步 core/ 与 ui/，再打 debug + release）
powershell -ExecutionPolicy Bypass -File Android\tools\build-apk.ps1
# 只要其中一个：-DebugOnly / -ReleaseOnly
```

改了根目录的 `core/` 或 `ui/` 之后重新跑一次 `build-apk.ps1` 即可，
它内部会调用 `tools\sync-sources.ps1` 把源码同步进来。

> 工程路径含中文（`D:\硕士\cost`），所以 `gradle.properties` 里开了
> `android.overridePathCheck=true`；`local.properties` 在非 ASCII 路径下会被跳过，
> 构建脚本改用 `ANDROID_HOME` 环境变量告诉 Gradle SDK 位置。

## 装到手机

1. 把 `dist/MonthlyLedger-1.0-release.apk` 传到手机（微信/QQ/数据线都行），
   点安装并允许「安装未知来源应用」。应用名显示为 **月度账本**。
2. 或者用数据线 + adb：

```powershell
powershell -ExecutionPolicy Bypass -File Android\tools\install-apk.ps1
```

## 已经验证过什么

- **签名**：`apksigner verify` 通过（v2 方案，RSA 2048）
- **清单**：`com.cost.ledger` / 名称「月度账本」/ minSdk 24 / targetSdk 34 / ABI `arm64-v8a`、`x86_64`
- **包内容**：`lib/arm64-v8a/libpython3.14.so`、`assets/chaquopy/stdlib-*.imy`、
  `assets/chaquopy/cacert.pem`（Python 侧 HTTPS 可用）、`app.imy` 内含
  `core/*.pyc` 与 `android_entry.pyc`、`assets/ui/*` 界面资源齐全
- **后端**：`python Android\tools\smoke_test.py` → 24 项接口在「安卓模式」下全部通过
  （建库、增删改查、月度总览、智能分析、历史回顾、预算覆盖、AI 配置加密、
  CSV 导出、数据库快照）
- **界面 + 桥接（PC）**：`node Android\tools\webui_test.cjs` → 用系统 Edge 在 390×844
  视口渲染真实 HTML（含 `bridge.js`），5 个页面无 JS 报错、无横向溢出，
  13 个接口调用全部经桥接往返成功
  该脚本还会在 3 种视口（桌面 1240×840 / 模拟器横屏 853×480 / 手机 390×844）
  打开手动记账与 AI 记账弹窗，断言「底部按钮在可视区内、能滚到最后一项、
  安卓端不能出现内层滚动条、无横向溢出」，不通过就返回非 0。
- **真机级验证（MuMu 模拟器，Android 15 / API 35 / x86_64）**：
  `powershell -ExecutionPolicy Bypass -File Android\tools\device_test.ps1 -Serial 127.0.0.1:16384`
  1. 安装 + 启动成功，日志 `MonthlyLedger: Python ready in 29 ms, db=/data/user/0/com.cost.ledger/files/dataset/budget.db`
  2. 手动记账一笔 → 账单页出现该笔、概览与月度预测同步更新（截图 `device-step*.png`）
  3. 设置页显示真实安卓路径 `/data/data/com.cost.ledger/files/dataset/budget.db`
  4. 「导出全部流水」→ 系统「下载」目录出现
     `消费流水_全部_20260928_204701.csv`（UTF-8 BOM，Excel 可直接打开）
  5. 「打开数据文件夹」→ 系统「下载」目录出现 `月度账本备份-20260928-204718.db`
  6. 覆盖安装后数据仍在（账单页 3 笔记录未丢）

> 这一轮真机测试抓出并修掉了两个只在设备上才会暴露的问题，已写进代码注释：
> ① `MainActivity.buildHtml()` 里资源路径写成 `ui/js/` 少了文件名（PC 端脚本读磁盘，
> 测不到这段）；② 清单缺 `com.chaquo.python.android.PyApplication`，导致
> `Python.getInstance()` 抛 `Cannot use GenericPlatform on Android`。
> 现在 `buildHtml()` 会逐个检查资源并直接报出缺哪个，`tools/device_test.ps1`
> 会把「装上去能不能跑」变成可重复的一条命令。

## 还没验证 / 已知限制

- 只在 **x86_64 的 MuMu 模拟器（Android 15）** 上跑过。真机（arm64-v8a）理论上
  一样，但没有实际机型可测；同时注意模拟器是横屏 1280×720，用的是左侧栏布局，
  真机竖屏才会走到 `mobile.css` 的底部标签栏（那套布局在 PC 端 390×844 视口已验证）。
- 「AI 记账 / 月度复盘」的联网请求在设备上没实际发出去（模拟器里已确认能保存
  API Key、界面正常，但没消耗真实额度去跑一次请求）。
- 只打包 `arm64-v8a` + `x86_64`：**不支持 32 位老机型**。
  想支持得把 `chaquopy.version` 降到 `3.11`，并准备一个 3.11 的宿主 Python，
  同时把 `abiFilters` 换成 `armeabi-v7a`（Chaquopy 只在 Python ≤3.11 提供该 ABI）。
- APK 约 33.8MB，其中大部分是 Python 运行时和标准库。
- AI 记账 / 月度复盘仍需要自己在「设置」里填 OpenAI 兼容接口的 Key；
  它只在这两个动作上联网，其余功能全部离线。
- 首次启动会在应用私有目录建库并写一份备份，速度取决于手机。

## 目录一览

```
Android/
├─ app/                         Android 应用模块
│  ├─ build.gradle              Chaquopy + AGP 配置
│  └─ src/main/
│     ├─ AndroidManifest.xml
│     ├─ java/com/cost/ledger/MainActivity.java    WebView 外壳 + 原生桥
│     ├─ assets/android/bridge.js                  复刻 window.pywebview.api
│     ├─ assets/android/mobile.css                 手机布局补丁
│     ├─ assets/ui/                                由根目录 ui/ 同步
│     └─ python/                                   android_entry.py + 由根目录 core/ 同步
├─ tools/
│  ├─ fetch-toolchain.ps1       下载 JDK/SDK/Gradle 到 toolchain/
│  ├─ sync-sources.ps1          同步 core/ 与 ui/（唯一真源在仓库根目录）
│  ├─ build-apk.ps1             构建并收集 APK 到 dist/
│  ├─ install-apk.ps1           adb 安装
│  ├─ smoke_test.py             后端接口在安卓模式下的自检
│  ├─ webui_test.cjs            手机视口渲染 + 桥接自检（含截图）
│  └─ device_test.ps1           装到模拟器/真机里跑一遍并抓日志截图
├─ dist/                        最终 APK
├─ screenshots/                 界面验证截图
├─ keystore/                    签名库（口令见 gradle.properties）
├─ toolchain/                   下载的工具链（可随时删，约 1.2GB）
└─ .gradle-home/                Gradle 缓存（可随时删）
```

## 清理与重装

删掉 `Android/toolchain`、`Android/.gradle-home`、`Android/app/build`
可以回收约 1GB 以上空间；下次构建时 `fetch-toolchain.ps1` 会重新下载。
`dist/` 里的 APK 是构建产物，删了不会影响源码。
