package com.cost.ledger;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import com.chaquo.python.PyObject;
import com.chaquo.python.Python;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 安卓外壳：一个全屏 WebView 加载原来的 HTML/CSS/JS 界面，
 * 页面里的 window.pywebview.api 通过原生桥接到 Chaquopy 里的 Python 后端。
 */
public class MainActivity extends Activity {

    private static final String TAG = "MonthlyLedger";
    private static final String BASE_URL = "https://ledger.local/";
    private static final String[] JS_PARTS = {
            "00-util.js", "10-render.js", "20-forms.js", "30-boot.js",
    };
    /** 界面装配需要的全部资源。名字写错会在这里被点名，而不是黑屏。 */
    private static final String[] UI_ASSETS = {
            "ui/index.html", "ui/styles.css",
            "ui/js/00-util.js", "ui/js/10-render.js", "ui/js/20-forms.js", "ui/js/30-boot.js",
            "android/bridge.js", "android/mobile.css", "android/mobile.js",
    };

    private WebView webView;
    private PyObject entryModule;
    private final ExecutorService pool = Executors.newCachedThreadPool();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // 1) 启动 Python 后端：数据库、备份都落在应用私有目录
        long started = System.currentTimeMillis();
        try {
            entryModule = Python.getInstance().getModule("android_entry");
            String dbPath = entryModule
                    .callAttr("setup", getFilesDir().getAbsolutePath())
                    .toString();
            Log.i(TAG, "Python ready in " + (System.currentTimeMillis() - started)
                    + " ms, db=" + dbPath);
        } catch (Throwable error) {
            Log.e(TAG, "Python 初始化失败", error);
        }

        // 2) 组装界面
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.i(TAG, "console: " + message.message() + " ("
                        + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
        WebView.setWebContentsDebuggingEnabled(true);

        setContentView(webView, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        webView.loadDataWithBaseURL(BASE_URL, buildHtml(), "text/html", "UTF-8", null);
    }

    @Override
    protected void onDestroy() {
        pool.shutdown();
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------ 界面组装

    private String readAsset(String path) throws Exception {
        try (InputStream input = getAssets().open(path)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) > 0) {
                buffer.write(chunk, 0, read);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    /**
     * 和桌面版 app.py 的 build_html() 同样的思路：把 CSS/JS 内联进单个 HTML，
     * 额外在最前面插入安卓桥，并追加一段手机布局补丁。
     */
    private String buildHtml() {
        Map<String, String> assets = new LinkedHashMap<>();
        List<String> missing = new ArrayList<>();
        for (String path : UI_ASSETS) {
            try {
                assets.put(path, readAsset(path));
            } catch (Exception error) {
                missing.add(path + "：" + error);
            }
        }
        if (!missing.isEmpty()) {
            Log.e(TAG, "缺少界面资源 " + missing);
            return errorPage("缺少界面资源，请重新构建 APK。", missing);
        }

        String css = assets.get("ui/styles.css") + "\n\n" + assets.get("android/mobile.css");
        StringBuilder js = new StringBuilder();
        js.append(assets.get("android/bridge.js")).append("\n\n");
        for (String part : JS_PARTS) {
            js.append(assets.get("ui/js/" + part)).append("\n\n");
        }
        // 手机端交互增强放在最后，应用脚本先跑起来，它再补图标/抽屉/操作表
        js.append(assets.get("android/mobile.js"));
        return assets.get("ui/index.html")
                .replace("/*__STYLES__*/", css)
                .replace("/*__APP_JS__*/", js.toString());
    }

    private String errorPage(String title, List<String> details) {
        StringBuilder body = new StringBuilder()
                .append("<!doctype html><meta charset=\"utf-8\">")
                .append("<body style=\"font-family:sans-serif;padding:24px;line-height:1.8\">")
                .append("<h3 style=\"margin:0 0 12px\">").append(title).append("</h3>");
        for (String detail : details) {
            body.append("<div style=\"font-family:monospace;font-size:12px;color:#b3261e\">")
                    .append(detail).append("</div>");
        }
        return body.append("</body>").toString();
    }

    private void resolveCall(final String id, final String payload) {
        final String script = "window.__ledgerBridgeResolve("
                + JSONObject.quote(id) + "," + JSONObject.quote(payload) + ");";
        runOnUiThread(() -> {
            if (webView != null) {
                webView.evaluateJavascript(script, null);
            }
        });
    }

    private static String errorJson(String message) {
        return "{\"ok\":false,\"error\":" + JSONObject.quote(message) + "}";
    }

    // ---------------------------------------------------------------- 原生桥

    private class Bridge {

        /** 页面调用的入口：方法与 pywebview 的 js_api 完全一致。 */
        @JavascriptInterface
        public void request(final String id, final String method, final String argsJson) {
            if (entryModule == null) {
                resolveCall(id, errorJson("Python 后端未启动，请重启应用"));
                return;
            }
            pool.execute(() -> {
                String payload;
                try {
                    payload = entryModule.callAttr(
                            "call_json", method, argsJson == null ? "[]" : argsJson
                    ).toString();
                } catch (Throwable error) {
                    Log.e(TAG, "调用 " + method + " 失败", error);
                    payload = errorJson("后端调用失败：" + error);
                }
                resolveCall(id, payload);
            });
        }

        /** 把应用私有目录里的文件复制到系统「下载」目录，返回展示用的位置。 */
        @JavascriptInterface
        public String saveToDownloads(String sourcePath, String displayName) {
            try {
                File source = new File(sourcePath);
                if (!source.isFile()) {
                    return "";
                }
                String name = displayName == null || displayName.isEmpty()
                        ? source.getName() : displayName;

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentResolver resolver = getContentResolver();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    values.put(MediaStore.Downloads.MIME_TYPE, guessMimeType(name));
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (uri == null) {
                        return "";
                    }
                    try (InputStream in = new FileInputStream(source);
                         OutputStream out = resolver.openOutputStream(uri)) {
                        if (out == null) {
                            return "";
                        }
                        copyStream(in, out);
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    resolver.update(uri, values, null, null);
                    return "下载/" + name;
                }

                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                if (dir == null) {
                    return "";
                }
                if (!dir.exists() && !dir.mkdirs()) {
                    return "";
                }
                File target = new File(dir, name);
                try (InputStream in = new FileInputStream(source);
                     OutputStream out = new FileOutputStream(target)) {
                    copyStream(in, out);
                }
                return target.getAbsolutePath();
            } catch (Throwable error) {
                Log.e(TAG, "复制到下载目录失败", error);
                return "";
            }
        }

        /** 「打开数据目录」在安卓上改成：导出一份数据库快照到下载目录。 */
        @JavascriptInterface
        public void exportDatabase() {
            try {
                String snapshot = entryModule == null
                        ? "" : entryModule.callAttr("snapshot_db").toString();
                if (snapshot.isEmpty()) {
                    toast("数据备份失败");
                    return;
                }
                String stamp = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US)
                        .format(new Date());
                String saved = saveToDownloads(snapshot, "月度账本备份-" + stamp + ".db");
                toast(saved.isEmpty() ? "数据备份失败" : "数据库已备份到 " + saved);
            } catch (Throwable error) {
                Log.e(TAG, "导出数据库失败", error);
                toast("数据备份失败：" + error);
            }
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(() ->
                    Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
        }

        /** 点按的轻震动反馈，交给系统触感设置来决定是否真的震动。 */
        @JavascriptInterface
        public void vibrate(final int milliseconds) {
            runOnUiThread(() -> {
                if (webView == null) {
                    return;
                }
                webView.performHapticFeedback(
                        android.view.HapticFeedbackConstants.KEYBOARD_TAP);
            });
        }
    }

    private static String guessMimeType(String name) {
        String lower = name.toLowerCase(Locale.US);
        if (lower.endsWith(".csv")) {
            return "text/csv";
        }
        return "application/octet-stream";
    }

    private static void copyStream(InputStream in, OutputStream out) throws Exception {
        byte[] chunk = new byte[8192];
        int read;
        while ((read = in.read(chunk)) > 0) {
            out.write(chunk, 0, read);
        }
        out.flush();
    }
}
