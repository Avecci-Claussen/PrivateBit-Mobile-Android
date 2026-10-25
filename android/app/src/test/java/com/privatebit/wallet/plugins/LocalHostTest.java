package com.privatebit.wallet.plugins;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** Audit F-09: cleartext http in the site browser only for IP literals on the phone or local network. */
public class LocalHostTest {
    @Test public void localAddresses() {
        for (String h : new String[] { "localhost", "127.0.0.1", "10.0.0.5", "192.168.1.20", "172.16.0.1", "172.31.255.254" })
            assertTrue(h, DappBrowserPlugin.localHost(h));
    }

    @Test public void namesThatOnlyLookLocal() {
        for (String h : new String[] { "10.example.com", "127.evil.net", "192.168.1.20.attacker.io", "printer.local", "172.32.0.1", "172.15.0.1", "8.8.8.8", "", "999.1.1.1", "10.0.0" })
            assertFalse(h, DappBrowserPlugin.localHost(h));
        assertFalse(DappBrowserPlugin.localHost(null));
    }
}
