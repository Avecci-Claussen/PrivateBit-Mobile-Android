package com.privatebit.wallet.plugins;

import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** FLAG_SECURE while recovery words or keys are on screen: no screenshots, no recents preview. */
@CapacitorPlugin(name = "DeviceSecurity")
public class DeviceSecurityPlugin extends Plugin {
    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    /** The phone's font size setting (1.0 is default), for the page's own type scale. */
    @PluginMethod
    public void fontScale(PluginCall call) {
        JSObject r = new JSObject();
        r.put("scale", (double) getContext().getResources().getConfiguration().fontScale);
        call.resolve(r);
    }
}
