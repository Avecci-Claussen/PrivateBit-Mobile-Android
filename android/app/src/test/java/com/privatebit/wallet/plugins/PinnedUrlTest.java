package com.privatebit.wallet.plugins;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.fail;

import java.net.URL;
import org.junit.Test;

/** Audit L8 (independent): http connects to the address that was checked, not to the name again. */
public class PinnedUrlTest {
    @Test
    public void httpIsPinnedToTheCheckedAddress() throws Exception {
        URL u = new URL("http://127.0.0.1:8332/rest/chaininfo.json");
        URL p = NativeHttpPlugin.pinned(u);
        assertEquals("127.0.0.1", p.getHost());
        assertEquals(8332, p.getPort());
        assertEquals("/rest/chaininfo.json", p.getFile());
        URL v6 = NativeHttpPlugin.pinned(new URL("http://[::1]:3002/api/blocks/tip/height"));
        assertEquals("[0:0:0:0:0:0:0:1]", v6.getHost());
    }

    @Test
    public void httpsIsUnchanged() throws Exception {
        URL u = new URL("https://example.com/x");
        assertSame(u, NativeHttpPlugin.pinned(u));
    }

    @Test
    public void publicHttpIsRefused() throws Exception {
        try {
            NativeHttpPlugin.pinned(new URL("http://8.8.8.8/"));
            fail();
        } catch (SecurityException expected) {
            // refused
        }
    }
}
