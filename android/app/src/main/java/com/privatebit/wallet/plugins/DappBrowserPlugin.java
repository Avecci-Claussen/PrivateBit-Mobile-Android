package com.privatebit.wallet.plugins;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.privatebit.wallet.MainActivity;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.Set;

/**
 * The site browser: a separate WebView over the wallet. At document start it injects the same
 * provider as the extension (top frame only). Page messages reach the wallet through a
 * WebMessageListener, which tells us the page's real origin; the wallet decides everything.
 * The site has no access to the wallet's WebView, storage or native plugins.
 */
@CapacitorPlugin(name = "DappBrowser")
public class DappBrowserPlugin extends Plugin {
    private static final Set<String> ALL = Collections.singleton("*");
    private LinearLayout root;
    private WebView web;
    private TextView title;
    private JavaScriptReplyProxy proxy;
    private int tabSeq = 0;
    private String tab = "";
    private OnBackPressedCallback backCb;

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getContext().getResources().getDisplayMetrics());
    }

    private static final String OCTET = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";

    /**
     * http is allowed only for a site on this phone or the local network, by IP literal (audit
     * F-09: a name such as "10.example.com" or "printer.local" is resolved by DNS and could be
     * anyone, so names other than localhost need https).
     */
    static boolean localHost(String h) {
        if (h == null) return false;
        h = h.toLowerCase(Locale.ROOT);
        if (h.equals("localhost")) return true;
        if (!h.matches("^" + OCTET + "(\\." + OCTET + "){3}$")) return false;
        String[] p = h.split("\\.");
        int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
        return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
    }

    static boolean allowed(Uri u) {
        String s = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase(Locale.ROOT);
        // The wallet's own pages are served as https://localhost inside the app: never in the site browser.
        if (s.equals("https") && h.equals("localhost")) return false;
        return s.equals("https") || (s.equals("http") && localHost(h));
    }

    private String script() {
        try (InputStream in = getContext().getAssets().open("public/dapp-inject.js")) {
            java.io.ByteArrayOutputStream b = new java.io.ByteArrayOutputStream();
            byte[] c = new byte[8192];
            int n;
            while ((n = in.read(c)) > 0) b.write(c, 0, n);
            return new String(b.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    private void emit(String ev, JSObject o) { notifyListeners(ev, o); }

    private void setHost(Uri u) {
        if (title != null && u != null) title.setText(u.getHost() == null ? "" : u.getHost());
    }

    @SuppressLint("SetJavaScriptEnabled")
    @PluginMethod
    public void open(PluginCall call) {
        Uri uri = Uri.parse(call.getString("url", ""));
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", true));
        if (!allowed(uri)) { call.reject("Only https sites can be opened."); return; }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) || !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            call.reject("Update Android System WebView to use sites in PrivateBit.");
            return;
        }
        String js = script();
        if (js == null) { call.reject("The site provider is missing from this build."); return; }
        AppCompatActivity act = (AppCompatActivity) getActivity();
        act.runOnUiThread(() -> {
            destroy(false);
            int bg = dark ? Color.parseColor("#151027") : Color.parseColor("#F3F0E8");
            int fg = dark ? Color.parseColor("#F3F0E8") : Color.parseColor("#1D1733");
            int line = dark ? Color.parseColor("#2E2650") : Color.parseColor("#D8D3E6");
            root = new LinearLayout(act);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setBackgroundColor(bg);
            root.setClickable(true);
            LinearLayout bar = new LinearLayout(act);
            bar.setOrientation(LinearLayout.HORIZONTAL);
            bar.setGravity(Gravity.CENTER_VERTICAL);
            bar.setPadding(dp(8), 0, dp(8), 0);
            Button done = new Button(act);
            done.setText("Back to wallet");
            done.setAllCaps(false);
            done.setTextColor(fg);
            done.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            GradientDrawable pill = new GradientDrawable();
            pill.setCornerRadius(dp(10));
            pill.setStroke(dp(1), line);
            pill.setColor(bg);
            done.setBackground(pill);
            done.setMinHeight(dp(44));
            done.setMinimumHeight(dp(44));
            done.setPadding(dp(14), 0, dp(14), 0);
            done.setContentDescription("Close site and go back to the wallet");
            done.setOnClickListener((v) -> destroy(true));
            title = new TextView(act);
            title.setTextColor(fg);
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            title.setSingleLine(true);
            title.setEllipsize(TextUtils.TruncateAt.MIDDLE);
            title.setPadding(dp(12), 0, dp(4), 0);
            bar.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)));
            bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(60)));
            View rule = new View(act);
            rule.setBackgroundColor(line);
            root.addView(rule, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(1)));

            web = new WebView(act);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setAllowFileAccess(false);
            s.setAllowContentAccess(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            s.setSupportMultipleWindows(false);
            s.setJavaScriptCanOpenWindowsAutomatically(false);
            s.setGeolocationEnabled(false);
            s.setSaveFormData(false);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) androidx.webkit.WebSettingsCompat.setSafeBrowsingEnabled(s, true);
            WebViewCompat.addWebMessageListener(web, "privatebitBridge", ALL, (view, message, sourceOrigin, isMainFrame, reply) -> {
                if (!isMainFrame || message.getData() == null || !allowed(sourceOrigin)) return;
                if (reply != proxy) {
                    proxy = reply;
                    tab = "t" + (++tabSeq);
                }
                JSObject o = new JSObject();
                o.put("tab", tab);
                o.put("origin", sourceOrigin.getScheme() + "://" + sourceOrigin.getAuthority());
                o.put("message", message.getData());
                emit("message", o);
            });
            WebViewCompat.addDocumentStartJavaScript(web, js, ALL);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                    Uri u = r.getUrl();
                    String sc = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
                    if (sc.equals("bitcoin")) {
                        Intent i = new Intent(Intent.ACTION_VIEW, u, getContext(), MainActivity.class);
                        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        getActivity().startActivity(i);
                        return true;
                    }
                    if (!r.isForMainFrame()) return !allowed(u);
                    return !allowed(u);
                }
                @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail d) {
                    destroy(true); // a site crashing never takes the wallet with it
                    return true;
                }
                @Override public void onPageStarted(WebView v, String url, Bitmap fav) {
                    proxy = null;
                    tab = "";
                    setHost(Uri.parse(url));
                    JSObject o = new JSObject();
                    o.put("url", url);
                    emit("pageStarted", o);
                }
            });
            root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
            ViewCompat.setOnApplyWindowInsetsListener(root, (v, ins) -> {
                Insets i = ins.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewGroup content = act.findViewById(android.R.id.content);
            content.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            ViewCompat.requestApplyInsets(root);
            backCb = new OnBackPressedCallback(true) {
                @Override public void handleOnBackPressed() {
                    if (web != null && web.canGoBack()) web.goBack();
                    else destroy(true);
                }
            };
            act.getOnBackPressedDispatcher().addCallback(act, backCb);
            setHost(uri);
            web.loadUrl(uri.toString());
            call.resolve();
        });
    }

    private void destroy(boolean notify) {
        if (backCb != null) { backCb.remove(); backCb = null; }
        if (root != null) {
            ((ViewGroup) root.getParent()).removeView(root);
            root = null;
        }
        if (web != null) {
            web.stopLoading();
            web.destroy();
            web = null;
        }
        proxy = null;
        tab = "";
        if (notify) emit("closed", new JSObject());
    }

    @PluginMethod
    public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> { destroy(true); call.resolve(); });
    }

    @PluginMethod
    public void setVisible(PluginCall call) {
        boolean v = Boolean.TRUE.equals(call.getBoolean("visible", true));
        getActivity().runOnUiThread(() -> {
            if (root != null) root.setVisibility(v ? View.VISIBLE : View.GONE);
            if (backCb != null) backCb.setEnabled(v);
            call.resolve();
        });
    }

    @PluginMethod
    public void post(PluginCall call) {
        String t = call.getString("tab", "");
        String m = call.getString("message");
        getActivity().runOnUiThread(() -> {
            if (proxy != null && t.equals(tab) && m != null) {
                proxy.postMessage(m);
                call.resolve();
            } else call.reject("closed");
        });
    }
}
