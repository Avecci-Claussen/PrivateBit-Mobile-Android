/**
 * chrome.storage for Android. "local" is one JSON document, encrypted by the native SecureStore
 * plugin with an AES-256-GCM key that lives in the Android Keystore and never leaves it. The
 * wallet's own encryption (password vault, data keys) sits inside that. "session" is memory only:
 * when Android ends the app process the wallet is locked, like a browser restart.
 */
import { SecureStore, isNative } from "./native.ts";

type Area = "local" | "session";
type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type Listener = (changes: Changes, area: Area) => void;

const WEB_KEY = "privatebit.android.webstore";
const listeners = new Set<Listener>();
const data: Record<Area, Record<string, unknown>> = { local: {}, session: {} };
let loadStatus: "ok" | "missing" | "unreadable" = "missing";

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

export const ready: Promise<void> = (async () => {
  if (isNative()) {
    const r = await SecureStore.load();
    loadStatus = r.status;
    try {
      data.local = r.data ? (JSON.parse(r.data) as Record<string, unknown>) : {};
    } catch {
      loadStatus = "unreadable";
      data.local = {};
    }
  } else {
    // Desktop browser layout runs only (never shipped as the app's store).
    const raw = localStorage.getItem(WEB_KEY);
    data.local = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  }
})();

export const storeStatus = (): string => loadStatus;

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 120);
}
export function flush(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  // A store this phone could not open is never overwritten by an empty one.
  if (loadStatus === "unreadable") return saving;
  const json = JSON.stringify(data.local);
  saving = saving.then(async () => {
    if (isNative()) await SecureStore.save({ data: json });
    else localStorage.setItem(WEB_KEY, json);
  });
  return saving;
}

function emit(changes: Changes, area: Area): void {
  if (!Object.keys(changes).length) return;
  for (const l of listeners) {
    try {
      l(changes, area);
    } catch {
      /* a listener threw */
    }
  }
}

function area(name: Area) {
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      await ready;
      const d = data[name];
      if (keys === null || keys === undefined) return clone(d);
      const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
      const out: Record<string, unknown> = {};
      for (const k of list) {
        if (k in d) out[k] = clone(d[k]);
        else if (!Array.isArray(keys) && typeof keys === "object" && keys) out[k] = (keys as Record<string, unknown>)[k];
      }
      return out;
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await ready;
      const d = data[name];
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        const nv = clone(v);
        changes[k] = { oldValue: d[k], newValue: nv };
        d[k] = nv;
      }
      if (name === "local") scheduleSave();
      emit(changes, name);
    },
    async remove(keys: string | string[]): Promise<void> {
      await ready;
      const d = data[name];
      const changes: Changes = {};
      for (const k of typeof keys === "string" ? [keys] : keys) {
        if (k in d) {
          changes[k] = { oldValue: d[k] };
          delete d[k];
        }
      }
      if (name === "local" && Object.keys(changes).length) scheduleSave();
      emit(changes, name);
    },
    async clear(): Promise<void> {
      await ready;
      const d = data[name];
      const changes: Changes = {};
      for (const k of Object.keys(d)) changes[k] = { oldValue: d[k] };
      data[name] = {};
      if (name === "local") {
        if (isNative()) await SecureStore.wipe();
        loadStatus = "missing";
        await flush();
      }
      emit(changes, name);
    },
  };
}

export const storage = {
  local: area("local"),
  session: area("session"),
  onChanged: {
    addListener: (fn: Listener) => listeners.add(fn),
    removeListener: (fn: Listener) => listeners.delete(fn),
  },
};
