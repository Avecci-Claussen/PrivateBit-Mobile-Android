package com.privatebit.wallet.plugins;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The wallet's app storage as one file, sealed with AES-256-GCM under a key that is created in
 * the Android Keystore and never leaves it. The file lives in no-backup storage. The wallet's own
 * password encryption sits inside this layer.
 */
@CapacitorPlugin(name = "SecureStore")
public class SecureStorePlugin extends Plugin {
    private static final String ALIAS = "privatebit.store.v1";
    private static final String FILE = "wallet-store.v1.bin";
    private static final byte VERSION = 1;
    private final Object lock = new Object();

    private File file() { return new File(getContext().getNoBackupFilesDir(), FILE); }

    private SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build());
        return kg.generateKey();
    }

    @PluginMethod
    public void load(PluginCall call) {
        synchronized (lock) {
            JSObject r = new JSObject();
            File f = file();
            if (!f.exists()) {
                r.put("data", null);
                r.put("status", "missing");
                call.resolve(r);
                return;
            }
            try {
                byte[] all = Files.readAllBytes(f.toPath());
                if (all.length < 1 + 12 + 16 || all[0] != VERSION) throw new IllegalStateException("format");
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(all, 1, 13)));
                c.updateAAD(new byte[] { VERSION });
                byte[] plain = c.doFinal(Arrays.copyOfRange(all, 13, all.length));
                r.put("data", new String(plain, StandardCharsets.UTF_8));
                r.put("status", "ok");
            } catch (Exception e) {
                // Never overwrite a file we could not open; the app shows the problem instead.
                r.put("data", null);
                r.put("status", "unreadable");
            }
            call.resolve(r);
        }
    }

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("no data"); return; }
        synchronized (lock) {
            try {
                Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
                c.init(Cipher.ENCRYPT_MODE, key());
                c.updateAAD(new byte[] { VERSION });
                byte[] ct = c.doFinal(data.getBytes(StandardCharsets.UTF_8));
                byte[] iv = c.getIV();
                File f = file();
                File tmp = new File(f.getParentFile(), FILE + ".tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) {
                    out.write(VERSION);
                    out.write(iv);
                    out.write(ct);
                    out.getFD().sync();
                }
                if (!tmp.renameTo(f)) throw new IllegalStateException("rename");
                call.resolve();
            } catch (Exception e) {
                call.reject("Could not save wallet data on this phone.");
            }
        }
    }

    @PluginMethod
    public void wipe(PluginCall call) {
        synchronized (lock) {
            File f = file();
            if (f.exists() && !f.delete()) { call.reject("Could not remove wallet data."); return; }
            call.resolve();
        }
    }
}
