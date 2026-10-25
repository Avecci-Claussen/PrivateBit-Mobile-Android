/**
 * The extension's background worker runs inside the app's page here. This file gives it the
 * small part of the chrome.* API it uses: storage (storage.ts), messages between the screens and
 * the background, alarms, the approval "window" for websites and ports for the in-app browser.
 * Must be imported before anything else.
 */
import { storage, flush } from "./storage.ts";
import { installFetch } from "./http.ts";

type Sender = { id: string; url: string; origin?: string; tab?: { id: number }; frameId?: number };
type MsgListener = (msg: unknown, sender: Sender, send: (r: unknown) => void) => boolean | void;

const ID = "privatebit-android";
const msgListeners = new Set<MsgListener>();
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

// ---------- alarms ----------
type Alarm = { name: string; scheduledTime: number; periodInMinutes?: number };
const alarms = new Map<string, Alarm>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const alarmListeners = new Set<(a: Alarm) => void>();
function arm(a: Alarm): void {
  clearTimeout(timers.get(a.name));
  const wait = Math.max(0, a.scheduledTime - Date.now());
  timers.set(a.name, setTimeout(() => fire(a.name), Math.min(wait, 2 ** 31 - 1)));
}
function fire(name: string): void {
  const a = alarms.get(name);
  if (!a) return;
  if (a.scheduledTime > Date.now() + 50) return arm(a);
  if (a.periodInMinutes) {
    a.scheduledTime = Date.now() + a.periodInMinutes * 60_000;
    arm(a);
  } else {
    alarms.delete(name);
    timers.delete(name);
  }
  for (const l of alarmListeners) l({ ...a });
}
/** After the app comes back to the foreground: run everything that came due while it slept. */
export function catchUpAlarms(): void {
  for (const a of [...alarms.values()]) if (a.scheduledTime <= Date.now()) fire(a.name);
  for (const a of alarms.values()) arm(a);
}

// ---------- approval "windows" (website requests) ----------
let nextWindow = 1;
const winRemoved = new Set<(id: number) => void>();
export const windowsOpen = new Map<number, string>();

// ---------- ports (in-app browser tabs) ----------
type PortMsgFn = (m: unknown) => void;
export type ShimPort = {
  name: string;
  sender: Sender;
  postMessage: (m: unknown) => void;
  disconnect: () => void;
  onMessage: { addListener: (fn: PortMsgFn) => void };
  onDisconnect: { addListener: (fn: () => void) => void };
};
const connectListeners = new Set<(p: ShimPort) => void>();
/** A page tab connects: the background sees a port with the origin the browser reported. */
export function openPort(name: string, sender: Sender, toPage: (m: unknown) => void): { port: ShimPort; fromPage: (m: unknown) => void; close: () => void } {
  const onMsg = new Set<PortMsgFn>();
  const onDis = new Set<() => void>();
  let open = true;
  const port: ShimPort = {
    name,
    sender,
    postMessage: (m) => {
      if (!open) throw new Error("port closed");
      toPage(clone(m));
    },
    disconnect: () => close(),
    onMessage: { addListener: (fn) => onMsg.add(fn) },
    onDisconnect: { addListener: (fn) => onDis.add(fn) },
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    for (const f of onDis) f();
  };
  for (const l of connectListeners) l(port);
  return { port, fromPage: (m) => open && onMsg.forEach((f) => f(clone(m))), close };
}

const manifest = { name: "PrivateBit", version: "1.0.0", manifest_version: 3 };

const chromeShim = {
  runtime: {
    id: ID,
    lastError: undefined,
    getURL: (p: string) => `${location.origin}/${p.replace(/^\//, "")}`,
    getManifest: () => manifest,
    openOptionsPage: async () => undefined,
    sendMessage(msg: unknown): Promise<unknown> {
      return new Promise((resolve) => {
        const sender: Sender = { id: ID, url: location.href };
        let answered = false;
        const send = (r: unknown): void => {
          if (answered) return;
          answered = true;
          resolve(clone(r));
        };
        let async = false;
        for (const l of msgListeners) if (l(clone(msg), sender, send) === true) async = true;
        if (!async && !answered) resolve(undefined);
      });
    },
    onMessage: { addListener: (fn: MsgListener) => msgListeners.add(fn), removeListener: (fn: MsgListener) => msgListeners.delete(fn) },
    onConnect: { addListener: (fn: (p: ShimPort) => void) => connectListeners.add(fn) },
    onInstalled: { addListener: (_fn: () => void) => undefined },
    onStartup: { addListener: (fn: () => void) => setTimeout(fn, 0) },
    connect: () => {
      throw new Error("not available in the app");
    },
  },
  storage,
  alarms: {
    create(name: string, info: { when?: number; delayInMinutes?: number; periodInMinutes?: number }): void {
      const at = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000;
      const a: Alarm = { name, scheduledTime: at, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) };
      alarms.set(name, a);
      arm(a);
    },
    async clear(name: string): Promise<boolean> {
      clearTimeout(timers.get(name));
      timers.delete(name);
      return alarms.delete(name);
    },
    async get(name: string) {
      return alarms.get(name);
    },
    onAlarm: { addListener: (fn: (a: Alarm) => void) => alarmListeners.add(fn) },
  },
  windows: {
    async create(o: { url?: string }): Promise<{ id: number }> {
      const id = nextWindow++;
      windowsOpen.set(id, o.url ?? "");
      window.dispatchEvent(new CustomEvent("pb-window-open", { detail: { id, url: o.url ?? "" } }));
      return { id };
    },
    async remove(id: number): Promise<void> {
      if (!windowsOpen.delete(id)) return;
      window.dispatchEvent(new CustomEvent("pb-window-close", { detail: { id } }));
      for (const f of winRemoved) f(id);
    },
    onRemoved: { addListener: (fn: (id: number) => void) => winRemoved.add(fn) },
  },
  permissions: {
    // Android has no per-host permission. The native client allows http only to local addresses.
    request: async () => true,
    contains: async () => true,
  },
};

(globalThis as unknown as { chrome: unknown }).chrome = chromeShim;
installFetch();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void flush();
  else catchUpAlarms();
});
