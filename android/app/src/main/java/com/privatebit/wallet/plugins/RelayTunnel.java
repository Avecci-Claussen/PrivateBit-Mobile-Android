package com.privatebit.wallet.plugins;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/** HTTP CONNECT tunnel through the OHTTP relay for one GET (no Android types, so a JVM can test it). */
public final class RelayTunnel {
    private RelayTunnel() {}

    /** Reads up to the end of the HTTP head (CRLF CRLF). */
    static String readHead(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int state = 0;
        while (true) {
            int ch = in.read();
            if (ch < 0) throw new IllegalStateException("Connection closed.");
            b.write(ch);
            if (b.size() > 16384) throw new IllegalStateException("Header too large.");
            state = (ch == '\r' && (state == 0 || state == 2)) ? state + 1 : (ch == '\n' && (state == 1 || state == 3)) ? state + 1 : 0;
            if (state == 4) return new String(b.toByteArray(), StandardCharsets.ISO_8859_1);
        }
    }

    private static SSLSocket tls(Socket under, String host, int port) throws Exception {
        SSLSocketFactory f = (SSLSocketFactory) SSLSocketFactory.getDefault();
        SSLSocket s = (SSLSocket) (under == null ? f.createSocket() : f.createSocket(under, host, port, true));
        if (under == null) s.connect(new InetSocketAddress(host, port), 15000);
        s.setSoTimeout(20000);
        // Host name checked during the handshake (RFC 2818 rules), with the system trust store.
        SSLParameters p = s.getSSLParameters();
        p.setEndpointIdentificationAlgorithm("HTTPS");
        s.setSSLParameters(p);
        try {
            s.startHandshake();
        } catch (javax.net.ssl.SSLException e) {
            s.close();
            throw new SecurityException("Could not verify " + host + ": " + e.getMessage());
        }
        return s;
    }

    /**
     * Security audit v1 (item 5): one GET through the OHTTP relay as an HTTP CONNECT tunnel
     * (BIP77 bootstrap), so the mailbox never sees this phone's IP even for its key list. TLS to
     * the relay, then TLS to the mailbox inside the tunnel, both checked against the system trust
     * store and host name. https only, no cookies, no redirects, 64 KB at most.
     */
    public static byte[] get(String relayUrl, String targetUrl) throws Exception {
        SSLSocket outer = null;
        try {
            URL relay = new URL(relayUrl);
            URL target = new URL(targetUrl);
            if (!relay.getProtocol().equals("https") || !target.getProtocol().equals("https")) throw new SecurityException("Relay and mailbox must use https.");
            int rp = relay.getPort() > 0 ? relay.getPort() : 443;
            int tp = target.getPort() > 0 ? target.getPort() : 443;
            outer = tls(null, relay.getHost(), rp);
            String authority = target.getHost() + ":" + tp;
            OutputStream o = outer.getOutputStream();
            o.write(("CONNECT " + authority + " HTTP/1.1\r\nHost: " + authority + "\r\nUser-Agent: Mozilla/5.0\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            o.flush();
            String head = readHead(outer.getInputStream());
            String[] first = head.split("\r\n", 2)[0].split(" ");
            if (first.length < 2 || !first[1].equals("200")) throw new IllegalStateException("The relay refused the tunnel (" + (first.length > 1 ? first[1] : "?") + ").");
            SSLSocket inner = tls(outer, target.getHost(), tp);
            String path = target.getFile().isEmpty() ? "/" : target.getFile();
            OutputStream io = inner.getOutputStream();
            io.write(("GET " + path + " HTTP/1.1\r\nHost: " + target.getAuthority() + "\r\nAccept: application/ohttp-keys\r\nUser-Agent: Mozilla/5.0\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.ISO_8859_1));
            io.flush();
            InputStream in = inner.getInputStream();
            String[] lines = readHead(in).split("\r\n");
            String[] st = lines[0].split(" ");
            int status = st.length > 1 ? Integer.parseInt(st[1]) : 0;
            boolean chunked = false;
            int length = -1;
            for (String l : lines) {
                String ll = l.toLowerCase(Locale.ROOT);
                if (ll.startsWith("transfer-encoding:") && ll.contains("chunked")) chunked = true;
                if (ll.startsWith("content-length:")) length = Integer.parseInt(ll.substring(15).trim());
            }
            byte[] data = readBody(in, chunked, length);
            inner.close();
            if (status != 200) throw new IllegalStateException("The mailbox answered " + status + ".");
            return data;
        } finally {
            if (outer != null) try { outer.close(); } catch (Exception ignored) {}
        }
    }

    static byte[] readBody(InputStream in, boolean chunked, int length) throws Exception {
        final int max = 65536;
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        if (chunked) {
            while (true) {
                StringBuilder sz = new StringBuilder();
                int ch;
                while ((ch = in.read()) >= 0 && ch != '\n') if (ch != '\r') sz.append((char) ch);
                if (ch < 0) throw new IllegalStateException("Connection closed.");
                String hexLen = sz.toString().split(";")[0].trim();
                if (hexLen.isEmpty()) continue;
                int n = Integer.parseInt(hexLen, 16);
                if (n == 0) break;
                if (n < 0 || body.size() + n > max) throw new IllegalStateException("Response too large.");
                byte[] chunk = new byte[n];
                int got = 0;
                while (got < n) { int r = in.read(chunk, got, n - got); if (r < 0) throw new IllegalStateException("Connection closed."); got += r; }
                body.write(chunk);
            }
        } else {
            if (length > max) throw new IllegalStateException("Response too large.");
            byte[] chunk = new byte[4096];
            int n;
            while ((length < 0 || body.size() < length) && (n = in.read(chunk, 0, length < 0 ? chunk.length : Math.min(chunk.length, length - body.size()))) > 0) {
                if (body.size() + n > max) throw new IllegalStateException("Response too large.");
                body.write(chunk, 0, n);
            }
        }
        return body.toByteArray();
    }
}
