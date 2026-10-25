import { describe, expect, it } from "vitest";
import { applyFontScale, fontScaleFromAgent, MAX_FONT_SCALE } from "../web/textscale.ts";

describe("text scale from the phone's font size", () => {
  it("reads the scale MainActivity puts in the user agent", () => {
    expect(fontScaleFromAgent("Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile PBFontScale/1.30")).toBe(1.3);
    expect(fontScaleFromAgent("Mozilla/5.0 Chrome/140")).toBeNull();
  });
  it("sets --fs and caps it at the size the layout is built for", () => {
    const el = document.createElement("html");
    expect(applyFontScale(1, el)).toBe(1);
    expect(el.style.getPropertyValue("--fs")).toBe("1.00");
    expect(el.dataset.fs).toBe("md");
    expect(applyFontScale(1.3, el)).toBe(1.3);
    expect(el.dataset.fs).toBe("lg");
    expect(applyFontScale(2, el)).toBe(MAX_FONT_SCALE);
    expect(el.style.getPropertyValue("--fs")).toBe("1.30");
    expect(applyFontScale(Number.NaN, el)).toBe(1);
    expect(applyFontScale(0.5, el)).toBe(0.85);
  });
});
