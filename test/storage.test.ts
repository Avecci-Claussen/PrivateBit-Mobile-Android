import { describe, expect, it, vi } from "vitest";
import { native } from "./fake-native.ts";

vi.mock("../web/shim/native.ts", () => import("./fake-native.ts"));

describe("Android storage shim", () => {
  it("never overwrites a store the phone could not open", async () => {
    vi.resetModules();
    native.stored = "sealed-but-unreadable";
    native.status = "unreadable";
    native.saves = 0;
    const st = await import("../web/shim/storage.ts");
    await st.ready.catch(() => undefined);
    expect(st.storeStatus()).toBe("unreadable");
    await st.storage.local.set({ fresh: true });
    await st.flush();
    expect(native.saves).toBe(0);
    expect(native.stored).toBe("sealed-but-unreadable");
  });

  it("keeps session values in memory only and saves local values as one document", async () => {
    vi.resetModules();
    native.stored = null;
    native.status = "missing";
    const st = await import("../web/shim/storage.ts");
    await st.storage.local.set({ a: { n: 1, big: "x".repeat(5) } });
    await st.storage.session.set({ secret: "only in memory" });
    await st.flush();
    expect(JSON.parse(native.stored!)).toEqual({ a: { n: 1, big: "xxxxx" } });
    expect(native.stored).not.toContain("only in memory");
    expect(await st.storage.session.get("secret")).toEqual({ secret: "only in memory" });
    const changes: any[] = [];
    st.storage.onChanged.addListener((c, area) => changes.push([area, c]));
    await st.storage.local.remove("a");
    expect(changes[0][0]).toBe("local");
    expect(await st.storage.local.get(["a"])).toEqual({});
    await st.storage.local.set({ b: 2 });
    await st.storage.local.clear();
    await st.flush();
    expect(JSON.parse(native.stored ?? "{}")).toEqual({});
  });

  it("values are copies, like chrome.storage", async () => {
    vi.resetModules();
    native.stored = null;
    native.status = "missing";
    const st = await import("../web/shim/storage.ts");
    const v = { list: [1, 2] };
    await st.storage.local.set({ v });
    v.list.push(3);
    const got = (await st.storage.local.get("v")).v as { list: number[] };
    expect(got.list).toEqual([1, 2]);
    got.list.push(9);
    expect(((await st.storage.local.get("v")).v as { list: number[] }).list).toEqual([1, 2]);
  });
});
