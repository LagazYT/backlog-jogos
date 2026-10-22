package com.lagaz.backlog;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final String USER_AGENT = "BacklogApp/1.0 (Android; app pessoal de backlog de jogos)";
    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    private File coverDir;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(Color.parseColor("#161922"));
        w.setNavigationBarColor(Color.parseColor("#161922"));

        coverDir = new File(getFilesDir(), "covers");
        //noinspection ResultOfMethodCallIgnored
        coverDir.mkdirs();

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#161922"));
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if ("file".equals(u.getScheme())) return false;
                // Links externos abrem no navegador do celular
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });
        web.loadUrl("file:///android_asset/www/index.html");
        setContentView(web);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        web.evaluateJavascript("window.__onSystemTheme && window.__onSystemTheme()", null);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.__onBack ? String(window.__onBack()) : 'false'", value -> {
            if (value == null || !value.contains("true")) finish();
        });
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        web.destroy();
        super.onDestroy();
    }

    private void reply(String id, boolean ok, String payload) {
        final String js = "window.__nativeCb(" + JSONObject.quote(id) + "," + ok + "," + JSONObject.quote(payload) + ")";
        runOnUiThread(() -> web.evaluateJavascript(js, null));
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(20000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", USER_AGENT);
        c.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9,en;q=0.8");
        return c;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toByteArray();
    }

    private static String safeName(String key) {
        return key.replaceAll("[^A-Za-z0-9_\\-]", "_");
    }

    /** Métodos chamados pelo JavaScript (window.AndroidBridge). */
    private class Bridge {

        @JavascriptInterface
        public void httpGet(final String url, final String id) {
            pool.submit(() -> {
                try {
                    HttpURLConnection c = open(url);
                    c.setRequestProperty("Accept", "application/json, text/html;q=0.9, */*;q=0.8");
                    if (url.contains("steamcommunity.com") || url.contains("steampowered.com")) {
                        c.setRequestProperty("Cookie", "birthtime=470682001; lastagecheckage=1-0-1985; wants_mature_content=1");
                    }
                    int code = c.getResponseCode();
                    if (code < 200 || code >= 300) { reply(id, false, "HTTP " + code); return; }
                    reply(id, true, new String(readAll(c.getInputStream()), StandardCharsets.UTF_8));
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Baixa a imagem e salva em files/covers. Responde com o caminho file://. */
        @JavascriptInterface
        public void downloadImage(final String url, final String key, final String id) {
            pool.submit(() -> {
                try {
                    byte[] data;
                    if (url.startsWith("file://")) {
                        data = readAll(new FileInputStream(new File(Uri.parse(url).getPath())));
                    } else {
                        HttpURLConnection c = open(url);
                        int code = c.getResponseCode();
                        String type = c.getContentType();
                        if (code < 200 || code >= 300 || type == null || !type.startsWith("image/")) {
                            reply(id, false, "sem imagem (" + code + ")");
                            return;
                        }
                        data = readAll(c.getInputStream());
                    }
                    // Confere se é mesmo uma imagem decodificável e com tamanho de capa
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(data, 0, data.length, o);
                    if (o.outWidth < 60 || o.outHeight < 60) { reply(id, false, "imagem inválida"); return; }

                    File f = new File(coverDir, safeName(key) + ".img");
                    try (OutputStream out = new FileOutputStream(f)) { out.write(data); }
                    reply(id, true, Uri.fromFile(f).toString());
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        @JavascriptInterface
        public boolean isSystemDark() {
            int m = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
            return m == Configuration.UI_MODE_NIGHT_YES;
        }

        /** Cor das barras do sistema e ícones claros/escuros conforme o tema. */
        @JavascriptInterface
        public void setBars(final String color, final boolean lightBackground) {
            runOnUiThread(() -> {
                try {
                    int c = Color.parseColor(color);
                    Window w = getWindow();
                    w.setStatusBarColor(c);
                    w.setNavigationBarColor(c);
                    web.setBackgroundColor(c);
                    View d = w.getDecorView();
                    int flags = d.getSystemUiVisibility();
                    int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
                    d.setSystemUiVisibility(lightBackground ? (flags | light) : (flags & ~light));
                } catch (Exception ignored) { }
            });
        }

        @JavascriptInterface
        public void share(final String text, final String title) {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("text/plain");
                i.putExtra(Intent.EXTRA_SUBJECT, title);
                i.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(i, title));
            });
        }

        @JavascriptInterface
        public void clearCovers(String prefix) {
            File[] files = coverDir.listFiles();
            if (files == null) return;
            String p = safeName(prefix);
            for (File f : files) {
                if (f.getName().startsWith(p)) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
        }

        @JavascriptInterface
        public void deleteFile(String fileUri) {
            try {
                File f = new File(Uri.parse(fileUri).getPath());
                if (f.getCanonicalPath().startsWith(coverDir.getCanonicalPath())) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            } catch (Exception ignored) { }
        }
    }
}
