/**
 * What PrivateBit tells you about, worked out by comparing two looks at the wallet (pure, so it is
 * unit tested). The app takes a look after each refresh while it runs; the first look after
 * unlocking or switching wallets only sets the starting point, so nothing old is announced.
 */
export type NotifyType = "received" | "confirmed" | "delayed" | "payjoin" | "failed";
export const NOTIFY_TYPES: { id: NotifyType; title: string; desc: string; channel: "Payments" | "Sending" }[] = [
  { id: "received", title: "Payment received", desc: "When a payment to you shows up", channel: "Payments" },
  { id: "confirmed", title: "Payment confirmed", desc: "When a payment to you is in a block", channel: "Payments" },
  { id: "delayed", title: "Delayed payment sent", desc: "When a payment you delayed goes out", channel: "Sending" },
  { id: "payjoin", title: "Payjoin completed", desc: "When a Payjoin with the other wallet finishes", channel: "Sending" },
  { id: "failed", title: "Payment not sent", desc: "When a payment could not be sent", channel: "Sending" },
];

export type NotifySettings = { enabled: boolean; showAmounts: boolean; types: Record<NotifyType, boolean> };
export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: false,
  showAmounts: false,
  types: { received: true, confirmed: true, delayed: true, payjoin: true, failed: true },
};
export function normalizeNotify(v: unknown): NotifySettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<NotifySettings>;
  const t = (o.types && typeof o.types === "object" ? o.types : {}) as Partial<Record<NotifyType, unknown>>;
  const types = { ...DEFAULT_NOTIFY.types };
  for (const k of Object.keys(types) as NotifyType[]) if (typeof t[k] === "boolean") types[k] = t[k] as boolean;
  return { enabled: o.enabled === true, showAmounts: o.showAmounts === true, types };
}

type HistRow = { txid: string; kind: string; status: string; amount: string };
type DelayedRow = { id: string; status: string; txid?: string; amount: string };
export type Snapshot = { wallet: string; rebuilding: boolean; history: Record<string, HistRow>; delayed: Record<string, DelayedRow> };

export function snapshot(wallet: string, history: { entries: HistRow[]; rebuilding?: boolean }, delayed: DelayedRow[]): Snapshot {
  const h: Record<string, HistRow> = {};
  for (const e of history.entries) h[e.txid] = { txid: e.txid, kind: e.kind, status: e.status, amount: e.amount };
  const d: Record<string, DelayedRow> = {};
  for (const x of delayed) d[x.id] = { id: x.id, status: x.status, txid: x.txid, amount: x.amount };
  return { wallet, rebuilding: history.rebuilding === true, history: h, delayed: d };
}

export type NotifyEvent = { type: NotifyType; txid?: string; sats: bigint };

const INCOMING = new Set(["received", "payjoin-received"]);
const OUTGOING = new Set(["sent", "payjoin-sent", "split", "self"]);
const abs = (s: string): bigint => {
  try {
    const v = BigInt(s);
    return v < 0n ? -v : v;
  } catch {
    return 0n;
  }
};

export function diffEvents(prev: Snapshot | null, next: Snapshot): NotifyEvent[] {
  if (!prev || prev.wallet !== next.wallet || next.rebuilding || prev.rebuilding) return [];
  const out: NotifyEvent[] = [];
  for (const e of Object.values(next.history)) {
    const old = prev.history[e.txid];
    if (!old) {
      if (e.kind === "payjoin-received" || e.kind === "payjoin-sent") out.push({ type: "payjoin", txid: e.txid, sats: abs(e.amount) });
      else if (INCOMING.has(e.kind)) out.push({ type: e.status === "confirmed" ? "confirmed" : "received", txid: e.txid, sats: abs(e.amount) });
      continue;
    }
    if (INCOMING.has(e.kind) && e.status === "confirmed" && old.status !== "confirmed") out.push({ type: "confirmed", txid: e.txid, sats: abs(e.amount) });
    if (OUTGOING.has(e.kind) && e.status === "failed" && old.status !== "failed") out.push({ type: "failed", txid: e.txid, sats: abs(e.amount) });
  }
  for (const d of Object.values(next.delayed)) {
    const old = prev.delayed[d.id];
    if (!old || old.status !== "waiting") continue;
    if (d.status === "sent") out.push({ type: "delayed", txid: d.txid, sats: abs(d.amount) });
    else if (d.status === "failed") out.push({ type: "failed", txid: d.txid, sats: abs(d.amount) });
  }
  return out;
}

/** Notification wording. Amounts only when you chose to show them; the lock screen never shows them. */
export function notifyText(ev: NotifyEvent, showAmounts: boolean, fmt: (sats: bigint) => string): { title: string; text: string } {
  const amt = showAmounts && ev.sats > 0n ? fmt(ev.sats) : "";
  switch (ev.type) {
    case "received":
      return { title: amt ? `PrivateBit: you received ${amt}` : "PrivateBit: you received a payment", text: "It is waiting for a block. Tap to see it." };
    case "confirmed":
      return { title: amt ? `PrivateBit: ${amt} confirmed` : "PrivateBit: a payment to you is confirmed", text: "It is now in a block. Tap to see it." };
    case "delayed":
      return { title: "PrivateBit: your delayed payment was sent", text: amt ? `${amt} went out as planned. Tap to see it.` : "It went out as planned. Tap to see it." };
    case "payjoin":
      return { title: "PrivateBit: Payjoin completed", text: amt ? `The Payjoin for ${amt} is done. Tap to see it.` : "The Payjoin with the other wallet is done. Tap to see it." };
    case "failed":
      return { title: "PrivateBit: a payment was not sent", text: "Nothing left your wallet. Open PrivateBit to try again." };
  }
}

/** Transactions the background check should follow until they are in a block (incoming only). */
export function watchList(s: Snapshot, showAmounts: boolean, fmt: (sats: bigint) => string): { txid: string; confirmedTitle: string; confirmedText: string }[] {
  return Object.values(s.history)
    .filter((e) => INCOMING.has(e.kind) && (e.status === "incoming" || e.status === "pending"))
    .slice(0, 50)
    .map((e) => {
      const t = notifyText({ type: "confirmed", txid: e.txid, sats: abs(e.amount) }, showAmounts, fmt);
      return { txid: e.txid, confirmedTitle: t.title, confirmedText: t.text };
    });
}

/** A tapped notification opens privatebit://tx/<txid>. */
export function txFromLink(url: string | undefined): string | null {
  const m = /^privatebit:\/\/tx\/([0-9a-f]{64})$/i.exec(url ?? "");
  return m ? m[1]!.toLowerCase() : null;
}
