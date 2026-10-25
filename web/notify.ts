/**
 * Opt-in notifications. Off until you turn them on; Android 13+ asks for permission at that
 * moment, not at first launch. While PrivateBit runs it compares the wallet after each refresh
 * (notify-core.ts). When it is closed, a WorkManager check (SyncWorker.java) asks the block data
 * source you chose whether known payments are in a block. It holds no keys, so finding brand new
 * payments to your receive code waits until the app runs again.
 */
import { S, screens, actions, go, render, toast } from "../shared/src/ui/app.ts";
import { call } from "../shared/src/ui/api.ts";
import { hdr } from "../shared/src/ui/chrome.ts";
import { fb, html, raw, I, type Safe } from "../shared/src/ui/kit.ts";
import { Notify, hasDevice, type NotifyPermission } from "./shim/native.ts";
import { DEFAULT_NOTIFY, NOTIFY_TYPES, diffEvents, normalizeNotify, notifyText, snapshot, txFromLink, watchList, type NotifySettings, type NotifyType, type Snapshot } from "./notify-core.ts";

const KEY = "pb.notify";
const TICK_MS = 20_000;
let cfg: NotifySettings = load();
let permission: NotifyPermission = "prompt";
let last: Snapshot | null = null;
let lastPushed = "";
let source: unknown = null;
let pendingTx: string | null = null;
/** Android refused when you turned them on: say so and point to its settings. */
let refused = false;

function load(): NotifySettings {
  try {
    return normalizeNotify(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return { ...DEFAULT_NOTIFY };
  }
}
function save(): void {
  localStorage.setItem(KEY, JSON.stringify(cfg));
}
const fmt = (v: bigint): string => fb(v, { unit: true, trim: true });
const walletId = (): string => S.b?.state.wallets?.find((w) => w.active)?.id ?? "default";

/** Sends the settings and watch list to the background check; starts or stops it. */
async function push(force = false): Promise<void> {
  if (!hasDevice()) return;
  if (cfg.enabled && S.b?.state.unlocked && !source) source = await call({ type: "WATCH_SOURCE" }).catch(() => null);
  const watch = cfg.enabled && last ? watchList(last, cfg.showAmounts, fmt) : [];
  // How far the wallet itself has read: the background check starts after that block.
  const seen = (S.b?.state as { lastHeight?: number } | undefined)?.lastHeight;
  const doc: Record<string, unknown> = { enabled: cfg.enabled, showAmounts: cfg.showAmounts, types: cfg.types, source, watch };
  const sig = JSON.stringify(doc);
  if (typeof seen === "number" && seen > 0) doc.seenHeight = seen;
  if (!force && sig === lastPushed) return;
  // While locked the wallet cannot be read; keep the last list rather than clearing it.
  if (cfg.enabled && !S.b?.state.unlocked && !force) return;
  lastPushed = sig;
  const r = await Notify.configure(doc).catch(() => null);
  if (r) permission = r.permission;
}

async function tick(): Promise<void> {
  if (!cfg.enabled || !S.b?.state.unlocked) {
    if (!S.b?.state.unlocked) last = null;
    return;
  }
  const id = walletId();
  const history = await call<{ entries: { txid: string; kind: string; status: string; amount: string }[]; rebuilding: boolean }>({ type: "HISTORY" }).catch(() => null);
  const b = await call<{ delayed?: { id: string; status: string; txid?: string; amount: string }[] }>({ type: "BUNDLE" }).catch(() => null);
  if (!history || !b) return;
  if (last && last.wallet !== id) source = null;
  const next = snapshot(id, history, b.delayed ?? []);
  const events = diffEvents(last, next);
  last = next;
  for (const ev of events) {
    if (!cfg.types[ev.type]) continue;
    const t = notifyText(ev, cfg.showAmounts, fmt);
    if (document.visibilityState === "visible") toast(t.title.replace(/^PrivateBit: /, "").replace(/^./, (c) => c.toUpperCase()));
    else await Notify.show({ type: ev.type, title: t.title, text: t.text, txid: ev.txid }).catch(() => undefined);
  }
  await push();
}

/* ---------- settings screen ---------- */
function sw(t: string, d: string, on: boolean, id: string, act: string, k = ""): Safe {
  return html`<label class="li swrow" for="${id}"><span class="body"><span class="t">${t}</span><span class="d">${d}</span></span><input class="switch" type="checkbox" role="switch" id="${id}" data-act="${act}" data-k="${k}" ${on ? html`checked` : ""}></label>`;
}

function summary(): string {
  if (!cfg.enabled) return "Off";
  if (permission === "denied") return "Blocked in Android settings";
  const n = NOTIFY_TYPES.filter((t) => cfg.types[t.id]).length;
  return `On, ${n} of ${NOTIFY_TYPES.length} kinds${cfg.showAmounts ? ", with amounts" : ""}`;
}

export function installNotify(): void {
  const settings = screens.settings;
  if (settings) {
    screens.settings = () => {
      const v = settings();
      if (!hasDevice()) return v;
      const row = html`<a class="li" href="#" data-act="go" data-to="set-notify"><span class="ico">${I("bell")}</span><span class="body"><span class="t">Notifications</span><span class="d">${summary()}</span></span>${I("chevron-right", "s16 chev")}</a>`;
      const at = v.main?.s.indexOf('data-to="set-backup"') ?? -1;
      if (!v.main || at < 0) return v;
      const start = v.main.s.lastIndexOf("<a ", at);
      return { ...v, main: raw(v.main.s.slice(0, start) + row.s + v.main.s.slice(start)) };
    };
  }

  screens["set-notify"] = () => {
    const blocked = refused || (cfg.enabled && permission === "denied");
    const groups = (["Payments", "Sending"] as const).map(
      (ch) => html`<h2 class="sec-h"><span>${ch}</span></h2><div class="list">${NOTIFY_TYPES.filter((t) => t.channel === ch).map((t) => sw(t.title, t.desc, cfg.types[t.id], `nt-${t.id}`, "nt-type", t.id))}</div>`,
    );
    return {
      title: "Notifications",
      header: hdr({ title: "Notifications" }),
      main: html`
  <div class="list">${sw("Notifications", cfg.enabled ? "On. Turn off to stop all PrivateBit notifications and the background check." : "Off. PrivateBit asks Android for permission only when you turn this on.", cfg.enabled, "nt-on", "nt-toggle")}</div>
  ${blocked ? html`<div class="banner warn" role="status">${I("bell-off", "s16")}<div><span class="bt">Blocked in Android settings</span>Android did not allow PrivateBit to show notifications. Allow them in Android settings, then turn this on again.</div></div><button class="btn btn-secondary btn-block" type="button" data-act="nt-settings">Open Android settings</button>` : ""}
  ${cfg.enabled ? html`${groups}
  <h2 class="sec-h"><span>Privacy</span></h2>
  <div class="list">${sw("Show amounts", cfg.showAmounts ? "Amounts are shown when your phone is unlocked. The lock screen still says only \u201cPrivateBit\u201d." : "Off. A notification says only what happened, like \u201cPrivateBit: you received a payment\u201d. The lock screen shows only \u201cPrivateBit\u201d.", cfg.showAmounts, "nt-amt", "nt-amounts")}</div>` : ""}
  <details class="card flat"><summary class="strong">How notifications work</summary><div class="stack small muted" data-st="8a77e5">
    <p>While PrivateBit is open or in your recent apps, it notices new payments to your receive code within about a minute.</p>
    <p>When it is closed, Android runs a short check about every 15 minutes when there is a network. It only asks your block data source whether payments PrivateBit already knows about are in a block. Your keys stay locked.</p>
    <p>Finding a brand new payment to your receive code needs your wallet's scan key. PrivateBit does not keep that key unlocked for background checks, so those payments are noticed the next time you open the app.</p>
    <p>To save battery, Android can delay background checks by hours (Doze and battery saver), so a notification can come late. Opening PrivateBit always checks right away.</p>
    <p>Tapping a notification opens the payment after you unlock.</p>
  </div></details>`,
    };
  };

  actions["nt-toggle"] = async (_el, ev) => {
    ev.preventDefault();
    if (cfg.enabled) {
      cfg.enabled = false;
      save();
      await push(true);
      toast("Notifications are off");
      render();
      return;
    }
    if (hasDevice()) {
      const r = await Notify.request().catch(() => null);
      permission = r?.permission ?? "denied";
      if (permission !== "granted") {
        refused = true;
        render();
        return;
      }
      refused = false;
    }
    cfg.enabled = true;
    save();
    last = null;
    await tick();
    await push(true);
    toast("Notifications are on");
    render();
  };
  actions["nt-type"] = async (el, ev) => {
    ev.preventDefault();
    const k = el.dataset.k as NotifyType;
    if (!(k in cfg.types)) return;
    cfg.types[k] = !cfg.types[k];
    save();
    await push();
    render();
  };
  actions["nt-amounts"] = async (_el, ev) => {
    ev.preventDefault();
    cfg.showAmounts = !cfg.showAmounts;
    save();
    await push();
    render();
  };
  actions["nt-settings"] = async () => {
    await Notify.openSettings().catch(() => undefined);
  };

  if (hasDevice()) {
    void Notify.status()
      .then((r) => {
        permission = r.permission;
        // Android settings turned them off, or the app data was cleared: match what Android says.
        if (cfg.enabled && !r.enabled && r.permission === "granted") void push(true);
      })
      .catch(() => undefined);
  }
  setInterval(() => void tick(), TICK_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void Notify.status().then((r) => {
        permission = r.permission;
        render();
      }).catch(() => undefined);
      void tick();
    }
  });
}

/* ---------- a tapped notification ---------- */
export function takeTxLink(url: string | undefined): boolean {
  const id = txFromLink(url);
  if (!id) return false;
  pendingTx = id;
  applyTxLink();
  return true;
}
export function applyTxLink(): void {
  if (!pendingTx || !S.b?.state.unlocked || S.dappId) return;
  if (["welcome", "seed", "verify", "import", "create-password", "import-password", "unlock", "boot", "starting"].includes(S.route)) return;
  const id = pendingTx;
  pendingTx = null;
  go("home", {}, { reset: true });
  go("activity-detail", { id });
}
