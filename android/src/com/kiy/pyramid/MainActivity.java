package com.kiy.pyramid;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Hosts the same web app that is published on GitHub Pages. Files are served
 * from the APK's assets under a secure https origin, so ES modules and
 * localStorage behave exactly as on the web.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int BACKGROUND = 0xFF0C1310;
    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("webmanifest", "application/manifest+json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
    }

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(0xFF151F1A);

        web = new WebView(this);
        web.setBackgroundColor(BACKGROUND);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        web.setWebViewClient(new AssetClient());
        if (getIntent().getBooleanExtra("selftest", false)) installSelfTest();
        setContentView(web);

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    @Override
    public void onBackPressed() {
        // screens are hash routes, so the web history is the navigation stack
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    /** Serves assets/www for our host; anything else opens in the browser. */
    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!HOST.equals(url.getHost())) return null;
            String path = url.getPath() == null || "/".equals(url.getPath()) ? "/index.html" : url.getPath();
            try {
                InputStream in = getAssets().open("www" + path);
                String ext = path.substring(path.lastIndexOf('.') + 1);
                String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
                return new WebResourceResponse(mime, "utf-8", 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-cache"), in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (HOST.equals(request.getUrl().getHost())) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (getIntent().getBooleanExtra("selftest", false)) runSelfTest();
        }
    }

    // ------------------------------------------------------------------ self-test
    // `am start -n com.kiy.pyramid/.MainActivity --ez selftest true` walks every
    // screen inside the real WebView and writes the result to Downloads.

    private boolean selfTestStarted;

    private void installSelfTest() {
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void report(String text) {
                // a fresh name every run: Downloads keeps track of files it has seen before
                writeDownload("pyramid-selftest-" + System.currentTimeMillis() + ".txt", text);
            }
        }, "AndroidSelfTest");
    }

    private void runSelfTest() {
        if (selfTestStarted) return;
        selfTestStarted = true;
        String js = "(async () => {"
                + " const log = []; const errors = [];"
                // the player's progress, settings and game in progress are put back afterwards
                + " const backup = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]));"
                + " addEventListener('error', e => errors.push(String(e.message)));"
                + " addEventListener('unhandledrejection', e => errors.push('promise: ' + e.reason));"
                + " const sleep = ms => new Promise(r => setTimeout(r, ms));"
                + " for (const r of ['lessons','lesson/2','lesson/11','lesson/12','lesson/14','practice','trainer','drill/klap1','quiz']) {"
                + "   location.hash = '#/' + r; await sleep(700);"
                + "   log.push(r + ': ' + document.getElementById('view').textContent.replace(/\\s+/g,' ').trim().slice(0, 60));"
                + " }"
                + " localStorage.removeItem('pyramid:game'); location.hash = '#/lessons'; await sleep(300); location.hash = '#/game'; await sleep(500);"
                + " [...document.querySelectorAll('button')].find(b => b.textContent.includes('Начать партию'))?.click(); await sleep(500);"
                + " document.querySelector('.cue-strip')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(6000);"
                + " log.push('after break: ' + document.querySelector('.status')?.textContent + ' | ' + document.querySelector('.status-detail')?.textContent);"
                + " log.push('scores: ' + [...document.querySelectorAll('.player-score b')].map(e => e.textContent).join(':'));"
                + " log.push('storage: ' + (localStorage.getItem('pyramid:game') ? 'saved game ok' : 'NO SAVED GAME'));"
                + " log.push('canvas size: ' + document.querySelector('canvas.table')?.width + 'x' + document.querySelector('canvas.table')?.height);"
                + " localStorage.removeItem('pyramid:game'); localStorage.setItem('pyramid:setting:variant', JSON.stringify('combined'));"
                + " location.hash = '#/lessons'; await sleep(300); location.hash = '#/game'; await sleep(500);"
                + " log.push('game: ' + document.querySelector('h1')?.textContent);"
                + " [...document.querySelectorAll('button')].find(b => b.textContent.includes('Начать партию'))?.click(); await sleep(500);"
                + " document.querySelector('.cue-strip')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(6000);"
                + " log.push('сибирка after break: ' + document.querySelector('.status')?.textContent + ' | ' + document.querySelector('.status-detail')?.textContent);"
                // колхоз on the table: three players, the computers play in turn
                + " localStorage.removeItem('pyramid:game'); localStorage.setItem('pyramid:setting:variant', JSON.stringify('free'));"
                + " location.hash = '#/lessons'; await sleep(300); location.hash = '#/game'; await sleep(500);"
                + " [...document.querySelectorAll('button')].find(b => b.textContent.includes('С компьютерами'))?.click(); await sleep(500);"
                + " document.querySelector('.cue-strip')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(6000);"
                + " log.push('колхоз: ' + document.querySelectorAll('.scoreboard .player').length + ' игрока | ' + [...document.querySelectorAll('.scoreboard .player')].map(e => e.textContent).join(' / ') + ' | ' + document.querySelector('.status')?.textContent + ' | ' + document.querySelector('.status-detail')?.textContent);"
                + " await sleep(15000);"
                + " log.push('колхоз later: ' + [...document.querySelectorAll('.scoreboard .player')].map(e => e.textContent).join(' / ') + ' | ' + document.querySelector('.status')?.textContent);"
                // the score sheet for a real table: a full round of 15 balls, round robin
                + " localStorage.removeItem('pyramid:game'); localStorage.removeItem('pyramid:kolkhoz'); localStorage.removeItem('pyramid:kolkhoz:setup');"
                + " location.hash = '#/kolkhoz'; await sleep(600);"
                + " [...document.querySelectorAll('button')].find(b => b.textContent.includes('Начать счёт'))?.click(); await sleep(400);"
                + " for (let k = 0; k < 15; k++) { document.querySelectorAll('.k-row')[k % 3]?.querySelector('.k-pot')?.click(); await sleep(120); }"
                + " log.push('счёт: ' + [...document.querySelectorAll('.k-pts b')].map(b => b.textContent).join(',') + ' | ' + [...document.querySelectorAll('.k-pay li')].map(l => l.textContent).join('; ') + ' | nav: ' + [...document.querySelectorAll('#nav a')].map(a => a.textContent).join(','));"
                + " log.push(errors.length ? 'ERRORS: ' + errors.join(' || ') : 'NO ERRORS');"
                + " localStorage.clear(); for (const [k, v] of Object.entries(backup)) localStorage.setItem(k, v);"
                + " log.push('state restored: ' + Object.keys(backup).length + ' keys'); location.hash = '#/lessons';"
                + " AndroidSelfTest.report(navigator.userAgent + '\\n' + log.join('\\n'));"
                + "})()";
        web.evaluateJavascript(js, null);
    }

    private void writeDownload(String name, String text) {
        if (Build.VERSION.SDK_INT < 29) return;
        ContentValues v = new ContentValues();
        v.put(MediaStore.Downloads.DISPLAY_NAME, name);
        v.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
        try {
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            }
        } catch (IOException | RuntimeException ignored) {
            // the report is a debugging aid only; never let it disturb the app
        }
    }
}
