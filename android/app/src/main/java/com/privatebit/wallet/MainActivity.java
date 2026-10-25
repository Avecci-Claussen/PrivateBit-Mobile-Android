package com.privatebit.wallet;

import android.os.Bundle;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.WebViewListener;
import com.getcapacitor.BridgeActivity;
import com.privatebit.wallet.plugins.BiometricPlugin;
import com.privatebit.wallet.plugins.DappBrowserPlugin;
import com.privatebit.wallet.plugins.DeviceSecurityPlugin;
import com.privatebit.wallet.plugins.NativeHttpPlugin;
import com.privatebit.wallet.plugins.NotifyPlugin;
import com.privatebit.wallet.plugins.SecureStorePlugin;

public class MainActivity extends BridgeActivity {
    /** Largest text scale the layout is built for. Above it, text stays at this size. */
    static final float MAX_FONT_SCALE = 1.3f;

    /**
     * Text size follows the phone's font size setting, but through the page's own type scale
     * (line heights and boxes grow with the text) instead of WebView text zoom, which enlarges
     * letters inside fixed-size boxes and made rows and chips overflow.
     */
    static String fontScaleTag(float scale) {
        float s = Math.max(0.85f, Math.min(MAX_FONT_SCALE, scale));
        return String.format(java.util.Locale.ROOT, "PBFontScale/%.2f", s);
    }

    @Override
    protected void load() {
        super.load();
        WebSettings settings = bridge.getWebView().getSettings();
        settings.setTextZoom(100);
        String tag = fontScaleTag(getResources().getConfiguration().fontScale);
        String ua = settings.getUserAgentString();
        if (!ua.contains("PBFontScale/")) settings.setUserAgentString(ua + " " + tag);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SecureStorePlugin.class);
        registerPlugin(NativeHttpPlugin.class);
        registerPlugin(DeviceSecurityPlugin.class);
        registerPlugin(BiometricPlugin.class);
        registerPlugin(DappBrowserPlugin.class);
        registerPlugin(NotifyPlugin.class);
        super.onCreate(savedInstanceState);
        // Audit F-12: no balance or activity in the recent apps thumbnail (Android 13+).
        if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false);
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
        // If Android ends the page's renderer, start the screen again instead of crashing. The
        // wallet is locked afterwards (its keys lived in that memory); saved data is untouched.
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                runOnUiThread(MainActivity.this::recreate);
                return true;
            }
        });
    }
}
