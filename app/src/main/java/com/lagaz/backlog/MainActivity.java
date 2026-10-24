package com.lagaz.backlog;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.webkit.CookieManager;
import android.view.Window;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.List;
import java.util.Map;

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
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final String USER_AGENT = "BacklogApp/1.0 (Android; app pessoal de backlog de jogos)";
    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);
    // Imagens em fila própria, para não atrasar as buscas e o login
    private final ExecutorService imagePool = Executors.newFixedThreadPool(3);
    private File coverDir;
    private volatile String webUA = USER_AGENT;
    private ValueCallback<Uri[]> fileCallback;
    private static final int PICK_FILE = 42;

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
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        webUA = s.getUserAgentString();

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        // Permite escolher fotos do celular em <input type="file">
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType("image/*");
                try {
                    startActivityForResult(Intent.createChooser(pick, "Escolher foto"), PICK_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });
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

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == PICK_FILE && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) result = new Uri[]{data.getData()};
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
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
        imagePool.shutdownNow();
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
            imagePool.submit(() -> {
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

        /** Requisição genérica (POST/PUT/PATCH/DELETE) usada pelo login e pela nuvem. */
        @JavascriptInterface
        public void httpRequest(final String method, final String url, final String body, final String contentType, final String id) {
            pool.submit(() -> {
                try {
                    HttpURLConnection c = open(url);
                    c.setRequestMethod(method);
                    c.setRequestProperty("Accept", "application/json");
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", contentType);
                        try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
                    }
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
                    if (code < 200 || code >= 300) { reply(id, false, "HTTP " + code + " " + text); return; }
                    reply(id, true, text);
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Abre o seletor de contas do Google e devolve o ID token. */
        @JavascriptInterface
        public void googleSignIn(final String webClientId, final String id) {
            runOnUiThread(() -> {
                try {
                    GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(webClientId).build();
                    GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
                    CredentialManager cm = CredentialManager.create(MainActivity.this);
                    Executor main = MainActivity.this::runOnUiThread;
                    cm.getCredentialAsync(MainActivity.this, request, new CancellationSignal(), main,
                        new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                            @Override
                            public void onResult(GetCredentialResponse response) {
                                Credential cred = response.getCredential();
                                if (cred instanceof CustomCredential
                                        && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(cred.getType())) {
                                    GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(cred.getData());
                                    reply(id, true, g.getIdToken());
                                } else {
                                    reply(id, false, "credencial inesperada");
                                }
                            }

                            @Override
                            public void onError(GetCredentialException e) {
                                reply(id, false, e instanceof GetCredentialCancellationException ? "cancelado" : String.valueOf(e.getMessage()));
                            }
                        });
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Baixa o APK novo para a pasta de cache, avisando o progresso. */
        @JavascriptInterface
        public void downloadUpdate(final String url, final String id) {
            pool.submit(() -> {
                try {
                    File dir = new File(getCacheDir(), "updates");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    File out = new File(dir, "Backlog.apk");
                    HttpURLConnection c = open(url);
                    c.setReadTimeout(60000);
                    int code = c.getResponseCode();
                    if (code < 200 || code >= 300) { reply(id, false, "HTTP " + code); return; }
                    long total = c.getContentLengthLong();
                    long done = 0;
                    int lastPct = -1;
                    try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            os.write(buf, 0, n);
                            done += n;
                            if (total > 0) {
                                int pct = (int) (done * 100 / total);
                                if (pct != lastPct) {
                                    lastPct = pct;
                                    final String js = "window.__updateProgress && window.__updateProgress(" + pct + ")";
                                    runOnUiThread(() -> web.evaluateJavascript(js, null));
                                }
                            }
                        }
                    }
                    reply(id, true, out.getAbsolutePath());
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Abre o instalador do Android. Devolve "ok", "permission" ou "missing". */
        @JavascriptInterface
        public String installUpdate() {
            File apk = new File(new File(getCacheDir(), "updates"), "Backlog.apk");
            if (!apk.exists()) return "missing";
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(() -> {
                    try {
                        startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
                    } catch (Exception ignored) { }
                });
                return "permission";
            }
            runOnUiThread(() -> {
                Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            });
            return "ok";
        }

        /**
         * Requisição completa: cabeçalhos em JSON, opção de não seguir redirecionamento.
         * Responde com JSON {status, location, body}.
         */
        @JavascriptInterface
        public void httpFull(final String method, final String url, final String headersJson, final String body,
                             final boolean follow, final String id) {
            pool.submit(() -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    c.setInstanceFollowRedirects(follow);
                    c.setRequestMethod(method);
                    c.setRequestProperty("User-Agent", USER_AGENT);
                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> it = h.keys();
                        while (it.hasNext()) { String k = it.next(); c.setRequestProperty(k, h.getString(k)); }
                    }
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true);
                        try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
                    }
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
                    JSONObject r = new JSONObject();
                    r.put("status", code);
                    String loc = c.getHeaderField("Location");
                    r.put("location", loc == null ? "" : loc);
                    r.put("body", text);
                    reply(id, true, r.toString());
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /**
         * Abre um navegador dentro do app para a pessoa entrar numa conta (Steam, PlayStation, Xbox).
         * Depois de cada página carregada roda captureJs; quando ele devolver texto, fecha e responde.
         * finishUrl: endereço aberto pelo botão "Concluir" (pode ser vazio).
         */
        @JavascriptInterface
        public void openLogin(final String title, final String startUrl, final String captureJs,
                              final String finishUrl, final String hint, final String id) {
            runOnUiThread(() -> {
                final Dialog dlg = new Dialog(MainActivity.this, android.R.style.Theme_Black_NoTitleBar);
                final boolean[] done = {false};
                LinearLayout root = new LinearLayout(MainActivity.this);
                root.setOrientation(LinearLayout.VERTICAL);
                root.setBackgroundColor(Color.parseColor("#0B0B0C"));

                LinearLayout bar = new LinearLayout(MainActivity.this);
                bar.setOrientation(LinearLayout.HORIZONTAL);
                bar.setGravity(Gravity.CENTER_VERTICAL);
                int pad = (int) (12 * getResources().getDisplayMetrics().density);
                bar.setPadding(pad, pad / 2, pad, pad / 2);
                Button close = new Button(MainActivity.this);
                close.setText("Fechar");
                TextView t = new TextView(MainActivity.this);
                t.setText(title);
                t.setTextColor(Color.WHITE);
                t.setTextSize(16);
                t.setPadding(pad, 0, pad, 0);
                LinearLayout.LayoutParams grow = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
                bar.addView(close);
                bar.addView(t, grow);
                final WebView lw = new WebView(MainActivity.this);
                if (finishUrl != null && !finishUrl.isEmpty()) {
                    Button fin = new Button(MainActivity.this);
                    fin.setText("Concluir");
                    fin.setOnClickListener(v -> lw.loadUrl(finishUrl));
                    bar.addView(fin);
                }
                root.addView(bar);
                if (hint != null && !hint.isEmpty()) {
                    TextView h = new TextView(MainActivity.this);
                    h.setText(hint);
                    h.setTextColor(Color.parseColor("#0B0B0C"));
                    h.setBackgroundColor(Color.parseColor("#FFD21F"));
                    h.setPadding(pad, pad / 2, pad, pad / 2);
                    h.setTextSize(13);
                    root.addView(h);
                }

                WebSettings ws = lw.getSettings();
                ws.setJavaScriptEnabled(true);
                ws.setDomStorageEnabled(true);
                CookieManager.getInstance().setAcceptCookie(true);
                CookieManager.getInstance().setAcceptThirdPartyCookies(lw, true);
                lw.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (done[0]) return;
                        view.evaluateJavascript("(function(){try{" + captureJs + "}catch(e){return null}})()", value -> {
                            if (done[0] || value == null || "null".equals(value) || "\"\"".equals(value)) return;
                            try {
                                String v = new JSONArray("[" + value + "]").getString(0);
                                if (v == null || v.isEmpty()) return;
                                done[0] = true;
                                reply(id, true, v);
                                dlg.dismiss();
                            } catch (Exception ignored) { }
                        });
                    }
                });
                root.addView(lw, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
                close.setOnClickListener(v -> dlg.dismiss());
                dlg.setOnDismissListener(d -> {
                    if (!done[0]) { done[0] = true; reply(id, false, "cancelado"); }
                    CookieManager.getInstance().flush();
                    lw.destroy();
                });
                dlg.setContentView(root);
                dlg.show();
                lw.loadUrl(startUrl);
            });
        }

        /** GET usando os cookies das telas de login (sessão Steam/Microsoft). Responde {status, location, body}. */
        @JavascriptInterface
        public void httpCookie(final String url, final boolean follow, final String id) {
            pool.submit(() -> {
                try {
                    HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(15000);
                    c.setReadTimeout(30000);
                    c.setInstanceFollowRedirects(follow);
                    c.setRequestProperty("User-Agent", webUA);
                    String ck = CookieManager.getInstance().getCookie(url);
                    if (ck != null) c.setRequestProperty("Cookie", ck);
                    int code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    String text = in == null ? "" : new String(readAll(in), StandardCharsets.UTF_8);
                    JSONObject r = new JSONObject();
                    r.put("status", code);
                    String loc = c.getHeaderField("Location");
                    r.put("location", loc == null ? "" : loc);
                    r.put("body", text);
                    reply(id, true, r.toString());
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Apaga a sessão salva (cookies) dos sites informados, separados por vírgula. */
        @JavascriptInterface
        public void clearSession(final String hostsCsv) {
            runOnUiThread(() -> {
                CookieManager cm = CookieManager.getInstance();
                for (String host : hostsCsv.split(",")) {
                    String h = host.trim();
                    if (h.isEmpty()) continue;
                    String url = "https://" + h;
                    String all = cm.getCookie(url);
                    if (all == null) continue;
                    String parent = h.indexOf('.') != h.lastIndexOf('.') ? h.substring(h.indexOf('.')) : "." + h;
                    for (String part : all.split(";")) {
                        String name = part.split("=", 2)[0].trim();
                        if (name.isEmpty()) continue;
                        String gone = name + "=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/";
                        cm.setCookie(url, gone);
                        cm.setCookie(url, gone + "; Domain=" + h);
                        cm.setCookie(url, gone + "; Domain=" + parent);
                    }
                }
                cm.flush();
            });
        }

        /** Lê uma imagem (file:// ou https) e devolve como data URL, para desenhar no cartão. */
        @JavascriptInterface
        public void imageData(final String url, final String id) {
            imagePool.submit(() -> {
                try {
                    byte[] data;
                    String mime = "image/jpeg";
                    if (url.startsWith("file://")) {
                        data = readAll(new FileInputStream(new File(Uri.parse(url).getPath())));
                    } else {
                        HttpURLConnection c = open(url);
                        int code = c.getResponseCode();
                        String type = c.getContentType();
                        if (code < 200 || code >= 300 || type == null || !type.startsWith("image/")) { reply(id, false, "sem imagem"); return; }
                        mime = type.split(";")[0].trim();
                        data = readAll(c.getInputStream());
                    }
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(data, 0, data.length, o);
                    if (o.outMimeType != null) mime = o.outMimeType;
                    if (o.outWidth < 20) { reply(id, false, "imagem inválida"); return; }
                    reply(id, true, "data:" + mime + ";base64," + Base64.encodeToString(data, Base64.NO_WRAP));
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        private byte[] decodeDataUrl(String dataUrl) {
            return Base64.decode(dataUrl.substring(dataUrl.indexOf(',') + 1), Base64.DEFAULT);
        }

        /** Compartilha um PNG (data URL) pelo menu do Android. */
        @JavascriptInterface
        public void shareImage(final String dataUrl, final String text, final String id) {
            pool.submit(() -> {
                try {
                    File dir = new File(getCacheDir(), "share");
                    //noinspection ResultOfMethodCallIgnored
                    dir.mkdirs();
                    File f = new File(dir, "backlog-" + System.currentTimeMillis() + ".png");
                    try (OutputStream out = new FileOutputStream(f)) { out.write(decodeDataUrl(dataUrl)); }
                    runOnUiThread(() -> {
                        Uri uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", f);
                        Intent i = new Intent(Intent.ACTION_SEND);
                        i.setType("image/png");
                        i.putExtra(Intent.EXTRA_STREAM, uri);
                        if (text != null && !text.isEmpty()) i.putExtra(Intent.EXTRA_TEXT, text);
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(Intent.createChooser(i, "Compartilhar"));
                    });
                    reply(id, true, "ok");
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
        }

        /** Salva um PNG (data URL) em Imagens/Backlog. */
        @JavascriptInterface
        public void saveImage(final String dataUrl, final String name, final String id) {
            pool.submit(() -> {
                try {
                    if (Build.VERSION.SDK_INT < 29) { reply(id, false, "antigo"); return; }
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Images.Media.DISPLAY_NAME, name + ".png");
                    v.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                    v.put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/Zerei");
                    Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) { reply(id, false, "sem acesso"); return; }
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(decodeDataUrl(dataUrl)); }
                    reply(id, true, "ok");
                } catch (Exception e) {
                    reply(id, false, String.valueOf(e.getMessage()));
                }
            });
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
