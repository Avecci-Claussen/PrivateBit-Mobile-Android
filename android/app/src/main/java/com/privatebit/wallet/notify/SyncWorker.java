package com.privatebit.wallet.notify;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Background check, about every 15 minutes when there is a network and Android allows it (Doze
 * and battery savers can delay it by hours). It never opens the wallet: it only asks the chosen
 * block data source whether the transactions on the watch list have reached a block, and posts
 * "confirmed" notifications. Finding new incoming payments to the receive code needs the wallet's
 * scan key and runs in the app.
 */
public class SyncWorker extends Worker {
    public static final String NAME = "privatebit.sync";

    public SyncWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    public static void schedule(Context c, boolean on) {
        WorkManager wm = WorkManager.getInstance(c);
        if (!on) {
            wm.cancelUniqueWork(NAME);
            return;
        }
        Constraints k = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(SyncWorker.class, 15, TimeUnit.MINUTES).setConstraints(k).build();
        wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, r);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        JSONObject cfg = NotifyStore.read(c);
        if (!cfg.optBoolean("enabled", false)) return Result.success();
        JSONObject src = cfg.optJSONObject("source");
        JSONArray items = cfg.optJSONArray("watch");
        if (src == null || items == null || items.length() == 0) return Result.success();
        JSONArray keep = new JSONArray();
        boolean changed = false;
        java.util.Set<String> inBlocks = null;
        if ("esplora".equals(src.optString("kind"))) {
            // Public mode: read the txid lists of new blocks and look on the phone, so the public
            // service never learns which transaction this wallet is waiting for.
            try {
                inBlocks = newBlockTxids(src, cfg);
                changed = true;
            } catch (Exception e) {
                return Result.success();
            }
        }
        for (int i = 0; i < items.length() && i < 50; i++) {
            JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            String txid = it.optString("txid", "");
            if (!txid.matches("[0-9a-f]{64}")) { changed = true; continue; }
            Boolean done;
            if (inBlocks != null) done = inBlocks.contains(txid);
            else {
                try {
                    done = confirmed(src, txid);
                } catch (Exception e) {
                    keep.put(it);
                    continue;
                }
            }
            if (Boolean.TRUE.equals(done)) {
                changed = true;
                if (Notifier.wants(cfg, "confirmed")) {
                    String title = it.optString("confirmedTitle", "PrivateBit: a payment is confirmed");
                    String text = it.optString("confirmedText", "It is now in a block. Open PrivateBit to see it.");
                    Notifier.post(c, "confirmed", title, text, txid);
                }
            } else keep.put(it);
        }
        if (changed) {
            try {
                cfg.put("watch", keep);
                NotifyStore.write(c, cfg);
            } catch (Exception ignored) {}
        }
        return Result.success();
    }

    /** Most blocks read per run. Further behind, the app catches up when it opens. */
    static final int MAX_BLOCKS = 40;

    /**
     * Txids of the blocks since the last run (Esplora: tip height, block hash, block txids). Saves
     * the new height in cfg ("seenHeight"). The first run only records the tip.
     */
    static java.util.Set<String> newBlockTxids(JSONObject src, JSONObject cfg) throws Exception {
        String root = src.optString("url").replaceAll("/+$", "");
        JSONObject headers = src.optJSONObject("headers");
        int tip = Integer.parseInt(http("GET", root + "/api/blocks/tip/height", headers, null).trim());
        int seen = cfg.optInt("seenHeight", -1);
        java.util.Set<String> out = new java.util.HashSet<>();
        int from = seen < 0 ? tip : Math.max(seen + 1, tip - MAX_BLOCKS + 1);
        for (int h = from; h <= tip; h++) {
            String hash = http("GET", root + "/api/block-height/" + h, headers, null).trim();
            if (!hash.matches("[0-9a-f]{64}")) throw new IllegalStateException("hash");
            JSONArray ids = new JSONArray(http("GET", root + "/api/block/" + hash + "/txids", headers, null));
            for (int k = 0; k < ids.length(); k++) out.add(ids.optString(k));
        }
        cfg.put("seenHeight", tip);
        return out;
    }

    /** Null when the source does not know the transaction yet. */
    static Boolean confirmed(JSONObject src, String txid) throws Exception {
        String kind = src.optString("kind");
        String url = src.optString("url");
        JSONObject headers = src.optJSONObject("headers");
        if ("core".equals(kind)) {
            String body = "{\"jsonrpc\":\"1.0\",\"id\":\"pb\",\"method\":\"getrawtransaction\",\"params\":[\"" + txid + "\",true]}";
            JSONObject r = new JSONObject(http("POST", url, headers, body));
            JSONObject res = r.optJSONObject("result");
            return res == null ? null : res.optInt("confirmations", 0) > 0;
        }
        return null;
    }

    static String http(String method, String url, JSONObject headers, String body) throws Exception {
        URL u = new URL(url);
        // Same rule as the app: https anywhere, http only to this phone or the local network.
        HttpURLConnection h = com.privatebit.wallet.plugins.NativeHttpPlugin.open(u);
        h.setConnectTimeout(15000);
        h.setReadTimeout(20000);
        h.setRequestMethod(method);
        h.setInstanceFollowRedirects(false);
        if (headers != null) {
            for (Iterator<String> k = headers.keys(); k.hasNext(); ) {
                String n = k.next();
                h.setRequestProperty(n, headers.optString(n));
            }
        }
        if (body != null) {
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = h.getResponseCode();
        if (code >= 500 || code == 429) throw new IllegalStateException("busy");
        try (InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream()) {
            if (in == null) return "{}";
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0 && out.size() < 1 << 20) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            h.disconnect();
        }
    }
}
