import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY, diffEvents, normalizeNotify, notifyText, snapshot, txFromLink, watchList } from "../web/notify-core.ts";

const T = (n: number) => n.toString(16).padStart(64, "0");
const fmt = (v: bigint) => `${Number(v) / 1e8} FB`;
const h = (entries: { txid: string; kind: string; status: string; amount: string }[], rebuilding = false) => ({ entries, rebuilding });

describe("notification events", () => {
  it("the first look only sets the starting point", () => {
    const s = snapshot("w", h([{ txid: T(1), kind: "received", status: "incoming", amount: "1000" }]), []);
    expect(diffEvents(null, s)).toEqual([]);
  });
  it("a new payment to you, then its confirmation", () => {
    const a = snapshot("w", h([]), []);
    const b = snapshot("w", h([{ txid: T(1), kind: "received", status: "incoming", amount: "1000" }]), []);
    const c = snapshot("w", h([{ txid: T(1), kind: "received", status: "confirmed", amount: "1000" }]), []);
    expect(diffEvents(a, b)).toEqual([{ type: "received", txid: T(1), sats: 1000n }]);
    expect(diffEvents(b, c)).toEqual([{ type: "confirmed", txid: T(1), sats: 1000n }]);
    expect(diffEvents(c, c)).toEqual([]);
  });
  it("a payment found already in a block is announced once, as confirmed", () => {
    const a = snapshot("w", h([]), []);
    const b = snapshot("w", h([{ txid: T(2), kind: "received", status: "confirmed", amount: "5" }]), []);
    expect(diffEvents(a, b).map((e) => e.type)).toEqual(["confirmed"]);
  });
  it("Payjoin rows say Payjoin completed, not received", () => {
    const a = snapshot("w", h([]), []);
    const b = snapshot("w", h([{ txid: T(3), kind: "payjoin-sent", status: "pending", amount: "-10000" }, { txid: T(4), kind: "payjoin-received", status: "incoming", amount: "10000" }]), []);
    expect(diffEvents(a, b).map((e) => [e.type, e.sats])).toEqual([["payjoin", 10000n], ["payjoin", 10000n]]);
  });
  it("delayed sends: sent and failed", () => {
    const a = snapshot("w", h([]), [{ id: "d1", status: "waiting", amount: "700" }, { id: "d2", status: "waiting", amount: "800" }]);
    const b = snapshot("w", h([]), [{ id: "d1", status: "sent", txid: T(5), amount: "700" }, { id: "d2", status: "failed", amount: "800" }]);
    expect(diffEvents(a, b).map((e) => e.type)).toEqual(["delayed", "failed"]);
  });
  it("a send that failed", () => {
    const a = snapshot("w", h([{ txid: T(6), kind: "sent", status: "pending", amount: "-1" }]), []);
    const b = snapshot("w", h([{ txid: T(6), kind: "sent", status: "failed", amount: "-1" }]), []);
    expect(diffEvents(a, b).map((e) => e.type)).toEqual(["failed"]);
  });
  it("nothing while history is rebuilt after a restore, or after switching wallets", () => {
    const a = snapshot("w", h([]), []);
    const b = snapshot("w", h([{ txid: T(7), kind: "received", status: "confirmed", amount: "1" }], true), []);
    const c = snapshot("other", h([{ txid: T(8), kind: "received", status: "incoming", amount: "1" }]), []);
    expect(diffEvents(a, b)).toEqual([]);
    expect(diffEvents(a, c)).toEqual([]);
  });
  it("sends and moves you made yourself are not announced as received", () => {
    const a = snapshot("w", h([]), []);
    const b = snapshot("w", h([{ txid: T(9), kind: "sent", status: "pending", amount: "-1" }, { txid: T(10), kind: "self", status: "pending", amount: "0" }, { txid: T(11), kind: "moved-in", status: "pending", amount: "9" }]), []);
    expect(diffEvents(a, b)).toEqual([]);
  });
});

describe("notification wording", () => {
  it("private by default: no amount", () => {
    const t = notifyText({ type: "received", txid: T(1), sats: 12345n }, false, fmt);
    expect(t.title).toBe("PrivateBit: you received a payment");
    expect(JSON.stringify(t)).not.toMatch(/\d/);
  });
  it("amounts only when chosen", () => {
    expect(notifyText({ type: "received", sats: 10000000n }, true, fmt).title).toBe("PrivateBit: you received 0.1 FB");
    expect(notifyText({ type: "payjoin", sats: 10000n }, true, fmt).text).toContain("0.0001 FB");
  });
  it("every type has a title and no dashes", () => {
    for (const type of ["received", "confirmed", "delayed", "payjoin", "failed"] as const) {
      for (const show of [false, true]) {
        const t = notifyText({ type, sats: 1n }, show, fmt);
        expect(t.title.startsWith("PrivateBit: ")).toBe(true);
        expect(`${t.title}${t.text}`).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });
});

describe("background watch list and links", () => {
  it("follows only incoming payments not yet in a block", () => {
    const s = snapshot("w", h([
      { txid: T(1), kind: "received", status: "incoming", amount: "1" },
      { txid: T(2), kind: "received", status: "confirmed", amount: "1" },
      { txid: T(3), kind: "sent", status: "pending", amount: "-1" },
      { txid: T(4), kind: "payjoin-received", status: "pending", amount: "1" },
    ]), []);
    const w = watchList(s, false, fmt);
    expect(w.map((x) => x.txid)).toEqual([T(1), T(4)]);
    expect(w[0]!.confirmedTitle).toBe("PrivateBit: a payment to you is confirmed");
  });
  it("settings: off and private by default, unknown values ignored", () => {
    expect(normalizeNotify(undefined)).toEqual(DEFAULT_NOTIFY);
    expect(normalizeNotify({ enabled: "yes", types: { received: false, bogus: true } }).types.received).toBe(false);
    expect(normalizeNotify({ enabled: "yes" }).enabled).toBe(false);
  });
  it("opens only well formed transaction links", () => {
    expect(txFromLink(`privatebit://tx/${T(1)}`)).toBe(T(1));
    expect(txFromLink("privatebit://tx/")).toBeNull();
    expect(txFromLink(`privatebit://tx/${T(1)}/../x`)).toBeNull();
    expect(txFromLink("bitcoin:bc1q")).toBeNull();
  });
});
