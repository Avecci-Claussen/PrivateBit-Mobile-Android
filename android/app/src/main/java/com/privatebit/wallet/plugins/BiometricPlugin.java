package com.privatebit.wallet.plugins;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Optional fingerprint or face unlock, on top of the password. The password is sealed with a
 * Keystore key that only works right after a strong biometric check, and that Android destroys
 * when fingerprints or faces are added or removed. Then the password is needed again.
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private static String alias(String id) { return "privatebit.bio." + id; }
    private SharedPreferences prefs() { return getContext().getSharedPreferences("privatebit_bio", Context.MODE_PRIVATE); }

    private static String cleanId(PluginCall call) {
        String id = call.getString("id", "");
        return id.matches("[A-Za-z0-9_-]{1,64}") ? id : null;
    }

    private SecretKey key(String id, boolean create) throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(alias(id)) && !create) return ((KeyStore.SecretKeyEntry) ks.getEntry(alias(id), null)).getSecretKey();
        if (!create) return null;
        if (ks.containsAlias(alias(id))) ks.deleteEntry(alias(id));
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(alias(id), KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= 30) b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(b.build());
        return kg.generateKey();
    }

    /** Fingerprint attempts in a row that did not match, across prompts. After 5 the password is needed. */
    static final int MAX_FAILS = 5;

    private int bootCount() {
        return Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.BOOT_COUNT, -1);
    }

    /** Called after every unlock with the password: biometrics may be used again until the next restart. */
    @PluginMethod
    public void passwordUsed(PluginCall call) {
        prefs().edit().putInt("_boot", bootCount()).putInt("_fails", 0).apply();
        call.resolve();
    }

    /** Why the password is needed instead, or null when fingerprint unlock may be offered. */
    private String needsPassword() {
        int boot = bootCount();
        if (boot >= 0 && prefs().getInt("_boot", -2) != boot) return "restart";
        if (prefs().getInt("_fails", 0) >= MAX_FAILS) return "tries";
        return null;
    }

    private void forget(String id) {
        prefs().edit().remove(id).apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            if (ks.containsAlias(alias(id))) ks.deleteEntry(alias(id));
        } catch (Exception ignored) {}
    }

    @PluginMethod
    public void available(PluginCall call) {
        int s = BiometricManager.from(getContext()).canAuthenticate(AUTH);
        JSObject r = new JSObject();
        r.put("available", s == BiometricManager.BIOMETRIC_SUCCESS);
        if (s == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED) r.put("reason", "none-enrolled");
        else if (s == BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE) r.put("reason", "busy");
        else if (s != BiometricManager.BIOMETRIC_SUCCESS) r.put("reason", "unsupported");
        PackageManager pm = getContext().getPackageManager();
        boolean finger = pm.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT);
        boolean face = Build.VERSION.SDK_INT >= 29 && pm.hasSystemFeature(PackageManager.FEATURE_FACE);
        r.put("kind", finger && face ? "both" : face ? "face" : "fingerprint");
        call.resolve(r);
    }

    @PluginMethod
    public void enabled(PluginCall call) {
        String id = cleanId(call);
        JSObject r = new JSObject();
        r.put("enabled", id != null && prefs().contains(id));
        call.resolve(r);
    }

    @PluginMethod
    public void disable(PluginCall call) {
        String id = cleanId(call);
        if (id != null) forget(id);
        call.resolve();
    }

    private void prompt(PluginCall call, Cipher cipher, Done done) {
        FragmentActivity act = (FragmentActivity) getActivity();
        act.runOnUiThread(() -> {
            final BiometricPrompt[] self = new BiometricPrompt[1];
            BiometricPrompt p = new BiometricPrompt(act, ContextCompat.getMainExecutor(act), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationFailed() {
                    int n = prefs().getInt("_fails", 0) + 1;
                    prefs().edit().putInt("_fails", n).apply();
                    if (n >= MAX_FAILS && self[0] != null) {
                        self[0].cancelAuthentication();
                        call.reject("Too many tries. Unlock with your password.", "tries");
                    }
                }
                @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult r) {
                    prefs().edit().putInt("_fails", 0).apply();
                    BiometricPrompt.CryptoObject co = r.getCryptoObject();
                    if (co == null || co.getCipher() == null) { call.reject("No key", "failed"); return; }
                    try { done.run(co.getCipher()); } catch (Exception e) { call.reject("Could not use the key", "failed"); }
                }
                @Override public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                    if (prefs().getInt("_fails", 0) >= MAX_FAILS) return; // already answered
                    boolean cancel = code == BiometricPrompt.ERROR_USER_CANCELED || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON || code == BiometricPrompt.ERROR_CANCELED;
                    boolean lockout = code == BiometricPrompt.ERROR_LOCKOUT || code == BiometricPrompt.ERROR_LOCKOUT_PERMANENT;
                    if (lockout) call.reject("Too many tries. Unlock with your password.", "lockout");
                    else call.reject(msg.toString(), cancel ? "cancelled" : "failed");
                }
            });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(call.getString("title", "Unlock PrivateBit"))
                .setSubtitle(call.getString("subtitle", ""))
                .setNegativeButtonText(call.getString("cancel", "Use password"))
                .setAllowedAuthenticators(AUTH)
                .setConfirmationRequired(false)
                .build();
            self[0] = p;
            p.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    interface Done { void run(Cipher c) throws Exception; }

    @PluginMethod
    public void enable(PluginCall call) {
        String id = cleanId(call);
        String secret = call.getString("secret");
        if (id == null || secret == null) { call.reject("Bad request"); return; }
        try {
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key(id, true));
            prompt(call, c, (done) -> {
                byte[] ct = done.doFinal(secret.getBytes(StandardCharsets.UTF_8));
                byte[] iv = done.getIV();
                byte[] all = new byte[iv.length + ct.length];
                System.arraycopy(iv, 0, all, 0, iv.length);
                System.arraycopy(ct, 0, all, iv.length, ct.length);
                prefs().edit().putString(id, Base64.encodeToString(all, Base64.NO_WRAP)).putInt("_boot", bootCount()).putInt("_fails", 0).apply();
                call.resolve();
            });
        } catch (Exception e) {
            forget(id);
            call.reject("Unlock with fingerprint or face is not available on this phone.", "failed");
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String id = cleanId(call);
        String stored = id == null ? null : prefs().getString(id, null);
        if (stored == null) { call.reject("Not set up", "missing"); return; }
        String why = needsPassword();
        if ("restart".equals(why)) { call.reject("Your phone restarted. Unlock with your password once.", "restart"); return; }
        if ("tries".equals(why)) { call.reject("Too many tries. Unlock with your password.", "tries"); return; }
        try {
            byte[] all = Base64.decode(stored, Base64.NO_WRAP);
            SecretKey k = key(id, false);
            if (k == null) throw new KeyPermanentlyInvalidatedException();
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, k, new GCMParameterSpec(128, Arrays.copyOfRange(all, 0, 12)));
            prompt(call, c, (done) -> {
                byte[] plain = done.doFinal(Arrays.copyOfRange(all, 12, all.length));
                JSObject r = new JSObject();
                r.put("secret", new String(plain, StandardCharsets.UTF_8));
                call.resolve(r);
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            forget(id);
            call.reject("Fingerprint or face settings changed on this phone. Unlock with your password, then turn it on again.", "changed");
        } catch (Exception e) {
            call.reject("Unlock with fingerprint or face is not available right now.", "failed");
        }
    }
}
