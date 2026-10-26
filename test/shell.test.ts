import { describe, expect, it, vi, beforeAll } from "vitest";
import { native } from "./fake-native.ts";

vi.mock("../web/shim/native.ts", () => import("./fake-native.ts"));

type Reply = { ok: boolean; data?: any; error?: string };
let send: (m: Record<string, unknown>) => Promise<Reply>;
let shim: typeof import("../web/shim/install.ts");

beforeAll(async () => {
  shim = await import("../web/shim/install.ts");
  await import("../shared/src/background.ts");
  send = (m) => chrome.runtime.sendMessage(m) as Promise<Reply>;
});

const words = (m: string) => m.split(" ");

describe("Android shell: wallet over the shim", () => {
  it("runs the shared background: create, lock, unlock", async () => {
    const st = await send({ type: "STATE" });
    expect(st.ok).toBe(true);
    expect(st.data.hasVault).toBe(false);
    const ob = await send({ type: "NEW_MNEMONIC" });
    expect(words(ob.data.mnemonic)).toHaveLength(24);
    const checks = [0, 8, 16].map((index) => ({ index, word: words(ob.data.mnemonic)[index] }));
    const made = await send({ type: "CREATE_CHECKED", password: "correct horse battery", name: "Phone test", checks });
    expect(made.ok, made.error).toBe(true);
    const s2 = await send({ type: "STATE" });
    expect(s2.data.unlocked).toBe(true);
    expect(s2.data.wallets.find((w: any) => w.active).name).toBe("Phone test");
    expect((await send({ type: "LOCK" })).ok).toBe(true);
    expect((await send({ type: "STATE" })).data.unlocked).toBe(false);
    expect((await send({ type: "UNLOCK", password: "wrong one" })).ok).toBe(false);
    expect((await send({ type: "UNLOCK", password: "correct horse battery" })).ok).toBe(true);
    // what reached the encrypted native store
    const { flush } = await import("../web/shim/storage.ts");
    await flush();
    expect(native.stored).toBeTruthy();
    const doc = native.stored!;
    for (const w of words(ob.data.mnemonic).slice(0, 6)) expect(doc).not.toMatch(new RegExp(`\\b${w}\\b.*\\b`));
    expect(doc).not.toContain(ob.data.mnemonic);
    expect(doc).not.toContain("correct horse battery");
    expect(doc).not.toContain("privatebit.onboard");
    expect(doc).not.toContain("privatebit.session");
  });

  it("website ports get the extension's provider answers, with origin from Android", async () => {
    const got: any[] = [];
    const t = shim.openPort("pb-dapp", { id: "privatebit-android", url: "https://app.example/", origin: "https://app.example", tab: { id: 1 }, frameId: 0 }, (m) => got.push(m));
    t.fromPage({ id: 1, method: "getAccounts" });
    t.fromPage({ id: 2, method: "getNetwork" });
    await vi.waitFor(() => expect(got.filter((m) => "id" in m).length).toBeGreaterThanOrEqual(2));
    const a = got.find((m) => m.id === 1);
    expect(a.result ?? a.error).toBeDefined();
    if (a.result) expect(a.result).toEqual([]);
    t.close();
  });

  it("approval requests open the in-app review and close it on reject", async () => {
    const opened: string[] = [];
    window.addEventListener("pb-window-open", (e) => opened.push((e as CustomEvent).detail.url));
    const got: any[] = [];
    const t = shim.openPort("pb-dapp", { id: "privatebit-android", url: "https://shop.example/", origin: "https://shop.example", tab: { id: 1 }, frameId: 0 }, (m) => got.push(m));
    t.fromPage({ id: 7, method: "requestAccounts" });
    await vi.waitFor(() => expect(opened.length).toBe(1));
    expect(opened[0]).toMatch(/#dapp=[0-9a-f]{24}$/);
    const id = [...shim.windowsOpen.keys()][0]!;
    await chrome.windows.remove(id);
    await vi.waitFor(() => expect(got.find((m) => m.id === 7)).toBeTruthy());
    expect(got.find((m) => m.id === 7).error.code).toBe(4001);
    t.close();
  });

  it("alarms that came due while the app slept run on resume", async () => {
    let ran = 0;
    chrome.alarms.onAlarm.addListener((a: { name: string }) => a.name === "test.resume" && ran++);
    chrome.alarms.create("test.resume", { when: Date.now() - 1 });
    shim.catchUpAlarms();
    expect(ran).toBe(1);
  });

  it("other origins go through the native client, never the WebView", async () => {
    native.http.length = 0;
    await expect(fetch("https://mempool.example/api/blocks/tip/height")).rejects.toThrow(TypeError);
    expect(native.http).toEqual([{ url: "https://mempool.example/api/blocks/tip/height", method: "GET" }]);
  });
});
