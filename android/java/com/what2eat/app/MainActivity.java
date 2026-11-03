package com.what2eat.app;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * 一个极薄的 WebView 壳：把 assets/www 里的离线页面当成一个网站跑。
 *
 * 为什么不用 file:// 直接加载：
 *   file:// 下的 localStorage 在各家 WebView 里行为不一致（个别机型直接禁掉），
 *   而这个应用的库存 / 菜谱全存在 localStorage 里，丢了就等于数据没了。
 *   所以这里用 https://w2e.local 作为虚拟域名，所有请求在 shouldInterceptRequest
 *   里从 assets 读文件返回，origin 稳定、DOM Storage 稳定，也不联网。
 */
public class MainActivity extends Activity {

    private static final String HOST = "w2e.local";
    private static final String BASE = "https://" + HOST + "/";
    private static final String BG = "#F4F1E9";

    private WebView web;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        Window w = getWindow();
        w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            w.setStatusBarColor(Color.parseColor(BG));
            w.setNavigationBarColor(Color.parseColor(BG));
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            // 浅色状态栏 → 黑色图标
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor(BG));
        root.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        web = new WebView(this);
        web.setLayoutParams(new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web.setBackgroundColor(Color.parseColor(BG));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        // 长按不弹「复制／搜索」菜单，这个页面不是文档
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage：库存就存这儿
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setUseWideViewPort(false);           // 页面自己有 viewport，别让系统再缩一次
        s.setLoadWithOverviewMode(false);
        s.setTextZoom(100);                    // 跟系统字体大小脱钩，430 竖屏画布才不会被撑破
        s.setDefaultTextEncodingName("utf-8");
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        web.setWebViewClient(new LocalClient());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                // 前端出问题的时候 adb logcat -s W2E 就能看到具体行
                Log.d("W2E", m.message() + "  @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        root.addView(web);
        setContentView(root);

        web.loadUrl(BASE + "index.html");
    }

    /* ---------------- 把虚拟域名映射到 assets/www ---------------- */

    private class LocalClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            return serve(req.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return serve(Uri.parse(url));
        }

        private WebResourceResponse serve(Uri uri) {
            if (uri == null || !HOST.equals(uri.getHost())) return null;
            String path = uri.getPath();
            if (path == null || path.length() == 0 || path.equals("/")) path = "/index.html";

            String name = "www" + path;
            try {
                InputStream in = getAssets().open(name);
                String mime = mimeOf(name);
                String enc = isText(name) ? "utf-8" : null;
                Map<String, String> h = new HashMap<String, String>();
                h.put("Cache-Control", "no-store");
                return new WebResourceResponse(mime, enc, 200, "OK", h, in);
            } catch (IOException e) {
                // 缺文件也回 404，而不是让 WebView 去联网（那样会转圈）
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        new HashMap<String, String>(),
                        new ByteArrayInputStream(new byte[0]));
            }
        }
    }

    private static boolean isText(String name) {
        return name.endsWith(".html") || name.endsWith(".css") || name.endsWith(".js")
                || name.endsWith(".json") || name.endsWith(".svg") || name.endsWith(".txt");
    }

    private static String mimeOf(String name) {
        if (name.endsWith(".html") || name.endsWith(".htm")) return "text/html";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".js")) return "application/javascript";
        if (name.endsWith(".json")) return "application/json";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
        if (name.endsWith(".webp")) return "image/webp";
        if (name.endsWith(".gif")) return "image/gif";
        if (name.endsWith(".ico")) return "image/x-icon";
        if (name.endsWith(".woff2")) return "font/woff2";
        if (name.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    /* ---------------- 返回键 ---------------- */

    private long lastBack = 0L;
    private boolean gone = false;   // Activity 已销毁，异步回调别再碰 WebView

    // 先问页面：有没有打开的弹窗 / 抽屉，有就先把它关掉
    private static final String JS_BACK =
            "(function(){" +
            "  var m = document.querySelector('#modalRoot.open');" +
            "  if (m) { var b = m.querySelector('[data-act=\"modal-close\"]'); if (b) { b.click(); return 'closed'; } }" +
            "  var s = document.getElementById('sheetRoot');" +
            "  if (s && s.classList.contains('open')) {" +
            "    var k = s.querySelector('[data-close]'); if (k) { k.click(); return 'closed'; }" +
            "  }" +
            "  return 'none';" +
            "})()";

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web == null) return super.onKeyDown(keyCode, event);
            web.evaluateJavascript(JS_BACK, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if (gone) return;
                    if (value != null && value.contains("closed")) return;
                    if (web != null && web.canGoBack()) {
                        web.goBack();
                        return;
                    }
                    // 退无可退：连按两次才退出，避免误触
                    long now = System.currentTimeMillis();
                    if (now - lastBack > 2000) {
                        lastBack = now;
                        Toast.makeText(MainActivity.this, "再按一次退出", Toast.LENGTH_SHORT).show();
                    } else {
                        finish();
                    }
                }
            });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
        // 触发一次 pagehide，让前端把防抖中的状态立刻落盘
        if (web != null && !gone) web.evaluateJavascript(
                "window.dispatchEvent(new Event('pagehide'))", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onDestroy() {
        gone = true;
        if (web != null) {
            // 顺序很重要：先摘掉 client，再从视图树里摘下来，最后才 destroy。
            web.setWebViewClient(null);
            web.setWebChromeClient(null);
            if (web.getParent() instanceof ViewGroup) {
                ((ViewGroup) web.getParent()).removeView(web);
            }
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
