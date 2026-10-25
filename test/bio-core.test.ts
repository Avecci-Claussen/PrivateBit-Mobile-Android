import { describe, expect, it } from "vitest";
import { bioAction, bioErrorText, bioUnavailableText, shouldAutoPrompt } from "../web/bio-core.ts";

describe("fingerprint or face unlock wording", () => {
  it("names the sensor the phone has", () => {
    expect(bioAction("fingerprint")).toBe("Unlock with fingerprint");
    expect(bioAction("face")).toBe("Unlock with face");
    expect(bioAction("both")).toBe("Unlock with fingerprint or face");
    expect(bioAction(undefined)).toBe("Unlock with fingerprint");
  });
  it("explains plainly why it is not offered", () => {
    expect(bioUnavailableText({ available: true })).toBeNull();
    expect(bioUnavailableText({ available: false, reason: "none-enrolled" })).toMatch(/Android Settings/);
    expect(bioUnavailableText({ available: false, reason: "unsupported" })).toMatch(/password only/);
  });
  it("password is needed after too many tries, a restart, or changed fingerprints", () => {
    expect(bioErrorText("tries", "fingerprint")).toMatch(/password/);
    expect(bioErrorText("lockout", "fingerprint")).toMatch(/password/);
    expect(bioErrorText("restart", "face")).toMatch(/restarted/);
    expect(bioErrorText("changed", "face")).toMatch(/turn it on again/);
    expect(bioErrorText("cancelled", "face")).toBeNull();
    expect(bioErrorText("failed", "face")).toMatch(/Use your password/);
  });
  it("prompts by itself once per lock, only when visible and idle", () => {
    expect(shouldAutoPrompt({ enabled: true, visible: true, alreadyTried: false, busy: false })).toBe(true);
    expect(shouldAutoPrompt({ enabled: true, visible: true, alreadyTried: true, busy: false })).toBe(false);
    expect(shouldAutoPrompt({ enabled: true, visible: false, alreadyTried: false, busy: false })).toBe(false);
    expect(shouldAutoPrompt({ enabled: false, visible: true, alreadyTried: false, busy: false })).toBe(false);
    expect(shouldAutoPrompt({ enabled: true, visible: true, alreadyTried: false, busy: true })).toBe(false);
  });
  it("copy has no dashes", () => {
    const all = ["tries", "restart", "changed", "failed"].map((c) => bioErrorText(c, "both")).join(" ") + bioUnavailableText({ available: false });
    expect(all).not.toMatch(/[\u2013\u2014]/);
  });
});
