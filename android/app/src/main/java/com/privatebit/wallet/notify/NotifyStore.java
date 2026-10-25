package com.privatebit.wallet.notify;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
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
import org.json.JSONObject;

/**
 * Notification settings and the short watch list the background check reads: transaction ids
 * waiting for a block, and how to reach the chosen block data source. No keys of any kind.
 * Sealed with AES-256-GCM under its own Android Keystore key that needs no fingerprint, so the
 * check can run while the wallet is locked. Stored in no-backup storage.
 */
public final class NotifyStore {
    private static final String ALIAS = "privatebit.notify.v1";
    private static final String FILE = "notify.v1.bin";
    private static final Object LOCK = new Object();

    private NotifyStore() {}

    private static File file(Context c) { return new File(c.getNoBackupFilesDir(), FILE); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return kg.generateKey();
    }

    public static JSONObject read(Context c) {
        synchronized (LOCK) {
            try {
                File f = file(c);
                if (!f.exists()) return new JSONObject();
                byte[] all = Files.readAllBytes(f.toPath());
                Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
                ci.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(all, 0, 12)));
                return new JSONObject(new String(ci.doFinal(Arrays.copyOfRange(all, 12, all.length)), StandardCharsets.UTF_8));
            } catch (Exception e) {
                return new JSONObject();
            }
        }
    }

    public static void write(Context c, JSONObject doc) throws Exception {
        synchronized (LOCK) {
            Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
            ci.init(Cipher.ENCRYPT_MODE, key());
            byte[] ct = ci.doFinal(doc.toString().getBytes(StandardCharsets.UTF_8));
            byte[] iv = ci.getIV();
            File tmp = new File(c.getNoBackupFilesDir(), FILE + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(iv);
                o.write(ct);
                o.getFD().sync();
            }
            if (!tmp.renameTo(file(c))) throw new IllegalStateException("rename");
        }
    }

    public static void clear(Context c) {
        synchronized (LOCK) {
            //noinspection ResultOfMethodCallIgnored
            file(c).delete();
        }
    }
}
