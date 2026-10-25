/**
 * Native plugins written for PrivateBit (android/app/src/main/java/.../plugins). Each has a
 * browser fallback so the same bundle also runs in a desktop browser for layout checks.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

export const isNative = (): boolean => Capacitor.isNativePlatform();

export type SecureStorePlugin = {
  load(): Promise<{ data: string | null; status: "ok" | "missing" | "unreadable" }>;
  save(o: { data: string }): Promise<void>;
  wipe(): Promise<void>;
};
export type NativeHttpPlugin = {
  request(o: { url: string; method: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<{ status: number; headers: Record<string, string>; body: string; url: string }>;
  /** One GET through an HTTP CONNECT tunnel at the relay (BIP77 key bootstrap). */
  viaRelay(o: { relay: string; url: string }): Promise<{ body: string }>;
};
export type DeviceSecurityPlugin = { setSecure(o: { on: boolean }): Promise<void>; fontScale(): Promise<{ scale: number }> };
export type BiometricPlugin = {
  available(): Promise<{ available: boolean; reason?: string; kind?: "fingerprint" | "face" | "both" }>;
  passwordUsed(): Promise<void>;
  enable(o: { id: string; secret: string; title: string; subtitle: string; cancel: string }): Promise<void>;
  unlock(o: { id: string; title: string; subtitle: string; cancel: string }): Promise<{ secret: string }>;
  disable(o: { id: string }): Promise<void>;
  enabled(o: { id: string }): Promise<{ enabled: boolean }>;
};
export type NotifyPermission = "granted" | "denied" | "prompt";
export type NotifyPlugin = {
  status(): Promise<{ permission: NotifyPermission; enabled: boolean }>;
  request(): Promise<{ permission: NotifyPermission; enabled: boolean }>;
  configure(o: Record<string, unknown>): Promise<{ permission: NotifyPermission; enabled: boolean }>;
  show(o: { type: string; title: string; text: string; txid?: string }): Promise<void>;
  openSettings(): Promise<void>;
};
export type DappBrowserPlugin = {
  open(o: { url: string; dark: boolean }): Promise<void>;
  close(): Promise<void>;
  setVisible(o: { visible: boolean }): Promise<void>;
  post(o: { tab: string; message: string }): Promise<void>;
  addListener(event: "message", fn: (e: { tab: string; origin: string; message: string }) => void): Promise<{ remove: () => void }>;
  addListener(event: "closed" | "pageStarted", fn: (e: { tab: string; origin?: string; url?: string }) => void): Promise<{ remove: () => void }>;
};

export const SecureStore = registerPlugin<SecureStorePlugin>("SecureStore");
export const NativeHttp = registerPlugin<NativeHttpPlugin>("NativeHttp");
export const DeviceSecurity = registerPlugin<DeviceSecurityPlugin>("DeviceSecurity");
/**
 * Layout checks in a desktop browser (vite --mode e2e only) can stand in a phone's sensor and
 * notification state through window.__pbDevice, so those screens can be checked. Production
 * builds never read it.
 */
const device = import.meta.env.MODE === "e2e" ? (globalThis as { __pbDevice?: { Biometric?: BiometricPlugin; Notify?: NotifyPlugin } }).__pbDevice : undefined;
/** A phone's sensor and notifications can be used (the app, or an e2e stand-in). */
export const hasDevice = (): boolean => isNative() || !!device;
export const Biometric = device?.Biometric ?? registerPlugin<BiometricPlugin>("Biometric");
export const Notify = device?.Notify ?? registerPlugin<NotifyPlugin>("Notify");
export const DappBrowser = registerPlugin<DappBrowserPlugin>("DappBrowser");
