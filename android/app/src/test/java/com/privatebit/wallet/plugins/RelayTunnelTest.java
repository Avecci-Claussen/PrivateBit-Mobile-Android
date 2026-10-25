package com.privatebit.wallet.plugins;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class RelayTunnelTest {
    private static ByteArrayInputStream in(String s) { return new ByteArrayInputStream(s.getBytes(StandardCharsets.ISO_8859_1)); }

    @Test public void readsHeadAndChunkedBody() throws Exception {
        ByteArrayInputStream s = in("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n2;x=1\r\nde\r\n0\r\n\r\n");
        assertEquals("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n", RelayTunnel.readHead(s));
        assertArrayEquals("abcde".getBytes(StandardCharsets.ISO_8859_1), RelayTunnel.readBody(s, true, -1));
    }

    @Test public void contentLengthStopsAtLength() throws Exception {
        assertArrayEquals("abc".getBytes(StandardCharsets.ISO_8859_1), RelayTunnel.readBody(in("abcdef"), false, 3));
    }

    @Test public void refusesOversizeAndPlainHttp() {
        assertThrows(IllegalStateException.class, () -> RelayTunnel.readBody(in(""), false, 70000));
        assertThrows(IllegalStateException.class, () -> RelayTunnel.readBody(in("20000\r\n"), true, -1));
        assertThrows(SecurityException.class, () -> RelayTunnel.get("http://relay.example", "https://mailbox.example/k"));
        assertThrows(SecurityException.class, () -> RelayTunnel.get("https://relay.example", "http://mailbox.example/k"));
    }
}
