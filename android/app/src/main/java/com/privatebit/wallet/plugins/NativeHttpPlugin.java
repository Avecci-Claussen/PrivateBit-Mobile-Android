package com.privatebit.wallet.plugins;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/**
 * The app's only network client. Rules:
 *  - https to any host (system trust store, no custom certificates).
 *  - http only when every address of the host is loopback, private (RFC 1918 / ULA) or
 *    link-local: that is a node on your own phone or home network. Anything else over http is
 *    refused before a connection is made, also after a redirect.
 *  - No cookies, no referrer, a generic user agent, redirects checked hop by hop, and a
 *    response size limit.
 */
@CapacitorPlugin(name = "NativeHttp")
public class NativeHttpPlugin extends Plugin {
    private static final int MAX_BYTES = 48 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    static boolean localAddress(InetAddress a) {
        if (a.isLoopbackAddress() || a.isLinkLocalAddress() || a.isSiteLocalAddress()) return true;
        if (a instanceof Inet6Address) {
            byte b = a.getAddress()[0];
            return (b & 0xfe) == 0xfc; // fc00::/7 unique local
        }
        if (a instanceof Inet4Address) {
            byte[] x = a.getAddress();
            int b0 = x[0] & 0xff, b1 = x[1] & 0xff;
            return b0 == 100 && b1 >= 64 && b1 <= 127; // 100.64.0.0/10, used by VPN meshes for home nodes
        }
        return false;
    }

    public static void checkUrl(URL u) throws Exception {
        pinned(u);
    }

    /**
     * Checks the URL and, for http, returns it with the host replaced by the address that was
     * checked. Audit L8 (independent): connecting by name after the check would let a DNS answer
     * change between the check and the connection (rebinding). https is returned unchanged, TLS
     * covers it.
     */
    public static URL pinned(URL u) throws Exception {
        String p = u.getProtocol().toLowerCase(Locale.ROOT);
        if (p.equals("https")) return u;
        if (!p.equals("http")) throw new SecurityException("Only https and local http addresses are allowed.");
        InetAddress[] all = InetAddress.getAllByName(u.getHost());
        if (all.length == 0) throw new SecurityException("Unknown host.");
        for (InetAddress a : all) {
            if (!localAddress(a)) throw new SecurityException("http is only allowed for a node on this phone or your local network. Use https for other servers.");
        }
        String ip = all[0].getHostAddress();
        int pct = ip.indexOf('%');
        if (ip.contains(":")) ip = "[" + (pct >= 0 ? ip.substring(0, pct) : ip) + "]";
        return new URL("http", ip, u.getPort(), u.getFile());
    }

    /** Opens a connection to the checked address, keeping the original Host header. */
    public static HttpURLConnection open(URL u) throws Exception {
        URL target = pinned(u);
        HttpURLConnection c = (HttpURLConnection) target.openConnection();
        if (target != u) c.setRequestProperty("Host", u.getAuthority());
        return c;
    }

    @PluginMethod
    public void request(PluginCall call) {
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                URL url = new URL(call.getString("url", ""));
                String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
                int timeout = Math.max(1000, Math.min(120000, call.getInt("timeoutMs", 60000)));
                JSObject hdrs = call.getObject("headers", new JSObject());
                String bodyB64 = call.getString("body");
                byte[] body = bodyB64 == null ? null : Base64.decode(bodyB64, Base64.NO_WRAP);
                String origin = url.getProtocol() + "://" + url.getAuthority();
                for (int hop = 0; ; hop++) {
                    c = open(url);
                    c.setInstanceFollowRedirects(false);
                    c.setUseCaches(false);
                    c.setConnectTimeout(timeout);
                    c.setReadTimeout(timeout);
                    c.setRequestMethod(method);
                    c.setRequestProperty("User-Agent", "Mozilla/5.0");
                    c.setRequestProperty("Accept-Language", "en");
                    boolean sameOrigin = origin.equals(url.getProtocol() + "://" + url.getAuthority());
                    Iterator<String> keys = hdrs.keys();
                    while (keys.hasNext()) {
                        String k = keys.next();
                        String lk = k.toLowerCase(Locale.ROOT);
                        if (lk.equals("cookie") || lk.equals("referer") || lk.equals("origin") || lk.equals("host") || lk.equals("content-length")) continue;
                        if (!sameOrigin && lk.equals("authorization")) continue;
                        c.setRequestProperty(k, hdrs.getString(k));
                    }
                    if (body != null && !method.equals("GET") && !method.equals("HEAD")) {
                        c.setDoOutput(true);
                        c.setFixedLengthStreamingMode(body.length);
                        try (OutputStream o = c.getOutputStream()) { o.write(body); }
                    }
                    int status = c.getResponseCode();
                    if (status >= 300 && status < 400 && status != 304 && c.getHeaderField("Location") != null) {
                        if (hop >= MAX_REDIRECTS) throw new IllegalStateException("Too many redirects.");
                        URL next = new URL(url, c.getHeaderField("Location"));
                        if (url.getProtocol().equals("https") && next.getProtocol().equals("http")) throw new SecurityException("Refused a redirect from https to http.");
                        c.disconnect();
                        url = next;
                        if (status == 303 || ((status == 301 || status == 302) && method.equals("POST"))) { method = "GET"; body = null; }
                        continue;
                    }
                    InputStream in = status >= 400 ? c.getErrorStream() : (method.equals("HEAD") ? null : c.getInputStream());
                    byte[] data = new byte[0];
                    if (in != null) {
                        try (InputStream s = in) {
                            ByteArrayOutputStream buf = new ByteArrayOutputStream();
                            byte[] chunk = new byte[16384];
                            int n;
                            while ((n = s.read(chunk)) > 0) {
                                if (buf.size() + n > MAX_BYTES) throw new IllegalStateException("Response too large.");
                                buf.write(chunk, 0, n);
                            }
                            data = buf.toByteArray();
                        }
                    }
                    JSONObject h = new JSONObject();
                    for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
                        if (e.getKey() == null) continue;
                        String lk = e.getKey().toLowerCase(Locale.ROOT);
                        if (lk.equals("set-cookie") || lk.equals("set-cookie2")) continue;
                        h.put(lk, String.join(", ", e.getValue()));
                    }
                    JSObject r = new JSObject();
                    r.put("status", status);
                    r.put("headers", h);
                    r.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                    r.put("url", url.toString());
                    call.resolve(r);
                    return;
                }
            } catch (SecurityException e) {
                call.reject(e.getMessage() == null ? "Refused." : e.getMessage());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Network error." : e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    /** Security audit v1 (item 5): one GET through the relay's CONNECT tunnel, see RelayTunnel. */
    @PluginMethod
    public void viaRelay(PluginCall call) {
        pool.execute(() -> {
            try {
                byte[] data = RelayTunnel.get(call.getString("relay", ""), call.getString("url", ""));
                JSObject r = new JSObject();
                r.put("body", Base64.encodeToString(data, Base64.NO_WRAP));
                call.resolve(r);
            } catch (SecurityException e) {
                call.reject(e.getMessage() == null ? "Refused." : e.getMessage());
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "Network error." : e.getMessage());
            }
        });
    }
}
