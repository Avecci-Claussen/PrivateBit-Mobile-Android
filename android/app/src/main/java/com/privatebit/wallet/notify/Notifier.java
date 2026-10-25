package com.privatebit.wallet.notify;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.privatebit.wallet.MainActivity;
import com.privatebit.wallet.R;
import org.json.JSONObject;

/** Posts PrivateBit notifications. Lock screen shows only a public version without amounts. */
public final class Notifier {
    public static final String CH_PAYMENTS = "payments";
    public static final String CH_SENDING = "sending";

    private Notifier() {}

    public static void channels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        NotificationChannel pay = new NotificationChannel(CH_PAYMENTS, "Payments", NotificationManager.IMPORTANCE_DEFAULT);
        pay.setDescription("Payments you receive and when they are confirmed");
        pay.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        NotificationChannel snd = new NotificationChannel(CH_SENDING, "Sending", NotificationManager.IMPORTANCE_DEFAULT);
        snd.setDescription("Delayed payments, Payjoin and payments that could not be sent");
        snd.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(pay);
        nm.createNotificationChannel(snd);
    }

    public static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33
            && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return NotificationManagerCompat.from(c).areNotificationsEnabled();
    }

    /** Which channel a notification type belongs to. */
    public static String channelFor(String type) {
        return "received".equals(type) || "confirmed".equals(type) ? CH_PAYMENTS : CH_SENDING;
    }

    /** True when the user turned this type on (all types are on once notifications are on). */
    public static boolean wants(JSONObject cfg, String type) {
        if (!cfg.optBoolean("enabled", false)) return false;
        JSONObject t = cfg.optJSONObject("types");
        return t == null || t.optBoolean(type, true);
    }

    /**
     * @param title  shown when the phone is unlocked, for example "PrivateBit: you received 0.1 FB"
     * @param text   detail line, may hold an amount only if the user chose to show amounts
     * @param txid   opened after unlock when the notification is tapped (may be null)
     */
    public static void post(Context c, String type, String title, String text, String txid) {
        if (!allowed(c)) return;
        channels(c);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("privatebit://tx/" + (txid == null ? "" : txid)), c, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int id = txid == null ? type.hashCode() : (type + txid).hashCode();
        PendingIntent pi = PendingIntent.getActivity(c, id, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder pub = new NotificationCompat.Builder(c, channelFor(type))
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle("PrivateBit")
            .setContentText("Open PrivateBit to see an update");
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channelFor(type))
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(pub.build())
            .setContentIntent(pi)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true);
        try {
            NotificationManagerCompat.from(c).notify(id, b.build());
        } catch (SecurityException ignored) {
            // Permission was taken back in system settings.
        }
    }
}
