/** Stand-ins for the Android plugins, so the shell can be tested off device. */
const g = globalThis as unknown as { __pbFakeNative?: typeof init };
const init = {
  stored: null as string | null,
  status: "missing" as "ok" | "missing" | "unreadable",
  saves: 0,
  http: [] as { url: string; method: string }[],
};
// One shared state, also across vi.resetModules().
export const native = (g.__pbFakeNative ??= init);
export const SecureStore = {
  async load() {
    return { data: native.stored, status: native.stored ? (native.status === "unreadable" ? "unreadable" : "ok") : native.status };
  },
  async save(o: { data: string }) {
    native.saves++;
    native.stored = o.data;
  },
  async wipe() {
    native.stored = null;
  },
};
export const NativeHttp = {
  async request(o: { url: string; method: string }) {
    native.http.push({ url: o.url, method: o.method });
    throw new Error("network disabled in unit tests");
  },
};
export const DeviceSecurity = { async setSecure() {}, async fontScale() { return { scale: 1 }; } };
export const Biometric = {};
export const DappBrowser = { async post() {}, async addListener() { return { remove() {} }; } };
export const isNative = () => true;
export const hasDevice = () => true;
export const Notify = { async status() { return { permission: "prompt", enabled: false }; }, async request() { return { permission: "granted", enabled: false }; }, async configure() { return { permission: "granted", enabled: false }; }, async show() {}, async openSettings() {} };
