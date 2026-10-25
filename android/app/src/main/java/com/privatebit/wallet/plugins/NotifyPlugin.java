package com.privatebit.wallet.plugins;

import android.Manifest;
import android.content.Intent;
import android.provider.Settings;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.privatebit.wallet.notify.NotifyStore;
import com.privatebit.wallet.notify.Notifier;
import com.privatebit.wallet.notify.SyncWorker;
import org.json.JSONObject;

/**
 * Opt-in notifications. The permission is asked only when you turn notifications on. Settings and
 * the watch list (see NotifyStore) are written by the app; the background check (SyncWorker) runs
 * only while notifications are on.
 */
@CapacitorPlugin(name = "Notify", permissions = { @Permission(alias = "notify", strings = { Manifest.permission.POST_NOTIFICATIONS }) })
public class NotifyPlugin extends Plugin {
    @Override
    public void load() {
        Notifier.channels(getContext());
    }

    private String permission() {
        if (Build.VERSION.SDK_INT < 33) return Notifier.allowed(getContext()) ? "granted" : "denied";
        PermissionState s = getPermissionState("notify");
        if (s == PermissionState.GRANTED) return Notifier.allowed(getContext()) ? "granted" : "denied";
        return s == PermissionState.DENIED ? "denied" : "prompt";
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", permission());
        r.put("enabled", NotifyStore.read(getContext()).optBoolean("enabled", false));
        call.resolve(r);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notify") == PermissionState.GRANTED) {
            status(call);
            return;
        }
        requestPermissionForAlias("notify", call, "afterRequest");
    }

    @PermissionCallback
    private void afterRequest(PluginCall call) {
        status(call);
    }

    /** Saves settings and the watch list, and starts or stops the background check. */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            JSONObject doc = new JSONObject(call.getData().toString());
            boolean on = doc.optBoolean("enabled", false) && Notifier.allowed(getContext());
            doc.put("enabled", on);
            if (on) {
                // Keep how far the background check has read unless the app knows better.
                JSONObject old = NotifyStore.read(getContext());
                if (!doc.has("seenHeight") && old.has("seenHeight")) doc.put("seenHeight", old.optInt("seenHeight"));
                NotifyStore.write(getContext(), doc);
            }
            else NotifyStore.clear(getContext());
            SyncWorker.schedule(getContext(), on);
            status(call);
        } catch (Exception e) {
            call.reject("Could not save notification settings.");
        }
    }

    @PluginMethod
    public void show(PluginCall call) {
        String type = call.getString("type", "");
        JSONObject cfg = NotifyStore.read(getContext());
        if (!Notifier.wants(cfg, type)) {
            call.resolve();
            return;
        }
        Notifier.post(getContext(), type, call.getString("title", "PrivateBit"), call.getString("text", ""), call.getString("txid"));
        call.resolve();
    }

    /** Android's notification settings for PrivateBit, for when notifications were turned off there. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
