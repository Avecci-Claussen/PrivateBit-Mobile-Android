// Design audit: every main screen at 320/360/375/412 and a tablet, dark and light, font scale 1.0 and 1.3.
// Measures horizontal overflow, clipped text, small touch targets and font sizes; screenshots each.
// PB_SIM=textzoom simulates the old WebView text zoom (font sizes scaled, layout not) for a "before" run.
// Offline mock chain, throwaway wallet, nothing is broadcast.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.env.PB_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../e2e-out/design");
const SIM = process.env.PB_SIM ?? "native";
const PORT = Number(process.env.PB_PORT ?? 4318);
const PW = "throwaway-phone-1";
const WIDTHS = (process.env.PB_WIDTHS ?? "320,360,375,412,800").split(",").map(Number);
const SCALES = (process.env.PB_SCALES ?? "1,1.3").split(",").map(Number);
const THEMES = (process.env.PB_THEMES ?? "dark,light").split(",");
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn("npx", ["vite", "preview", "--outDir", process.env.PB_DIST ?? "www-e2e", "--port", String(PORT), "--strictPort"], { cwd: new URL("../..", import.meta.url).pathname, stdio: "ignore" });
process.on("exit", () => srv.kill());
await sleep(2500);
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pb-design-")), {
  headless: true,
  executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
  args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"],
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  reducedMotion: "reduce",
});
// A phone's sensor and notification permission, for the e2e build only (web/shim/native.ts).
await ctx.addInitScript(() => {
  const st = () => JSON.parse(localStorage.getItem("e2e.dev") || "{}");
  const fail = (code) => Object.assign(new Error(code), { code });
  globalThis.__pbDevice = {
    Biometric: {
      async available() { const d = st(); return d.bio === "none" ? { available: false, reason: "none-enrolled", kind: "fingerprint" } : { available: true, kind: d.kind || "fingerprint" }; },
      async enabled() { return { enabled: st().bioOn === true }; },
      async enable() { localStorage.setItem("e2e.dev", JSON.stringify({ ...st(), bioOn: true })); },
      async disable() { localStorage.setItem("e2e.dev", JSON.stringify({ ...st(), bioOn: false })); },
      async unlock() { throw fail(st().unlockCode || "cancelled"); },
      async passwordUsed() {},
    },
    Notify: {
      async status() { return { permission: st().perm || "prompt", enabled: false }; },
      async request() { const p = st().deny ? "denied" : "granted"; localStorage.setItem("e2e.dev", JSON.stringify({ ...st(), perm: p })); return { permission: p, enabled: false }; },
      async configure(o) { return { permission: st().perm || "granted", enabled: !!o.enabled }; },
      async show() {},
      async openSettings() {},
    },
  };
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
const baseUA = await page.evaluate(() => navigator.userAgent);
async function setScale(fs) {
  await cdp.send("Emulation.setUserAgentOverride", { userAgent: SIM === "native" && fs !== 1 ? `${baseUA} PBFontScale/${fs}` : baseUA });
}
const settle = async (ms = 500) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
};
const send = (m) => page.evaluate((m) => chrome.runtime.sendMessage(m), m);
const act = async (data, ms = 800) => {
  await page.evaluate((d) => {
    const b = document.createElement("button");
    for (const [k, v] of Object.entries(d)) b.dataset[k] = v;
    document.querySelector("#app").appendChild(b);
    b.click();
    b.remove();
  }, data);
  await settle(ms);
};
const tap = async (sel, ms = 600) => {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => undefined);
  await l.click({ timeout: 30000 });
  await settle(ms);
};
async function simTextZoom(fs) {
  if (SIM !== "textzoom" || fs === 1) return;
  // WebView text zoom scales every font size; fixed line heights and box sizes stay.
  await page.evaluate((fs) => {
    if (document.getElementById("pb-sim")) return;
    const root = getComputedStyle(document.documentElement);
    const names = ["--t-display", "--t-title", "--t-body", "--t-body-strong", "--t-small", "--t-caption", "--t-mono", "--t-mono-strong"];
    const css = names
      .map((n) => {
        const v = root.getPropertyValue(n).trim();
        return `${n}:${v.replace(/([\d.]+)px\//, (_, a) => `${(Number(a) * fs).toFixed(1)}px/`)}`;
      })
      .join(";");
    let s = document.getElementById("pb-sim");
    if (!s) {
      s = document.createElement("style");
      s.id = "pb-sim";
      document.head.appendChild(s);
    }
    s.textContent = `:root,:root[data-theme]{${css}}`;
  }, fs);
}
async function measure() {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vis = (el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest(".sr-only,[hidden],.pb-scanner");
    };
    const name = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.textContent || "").trim().slice(0, 24)}"`;
    const inScroller = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === "auto" || o === "scroll") && p.scrollWidth > p.clientWidth) return true;
      }
      return false;
    };
    const over = [];
    const clipped = [];
    for (const el of document.querySelectorAll("#app *")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && !inScroller(el)) over.push(name(el));
      // Text cut without an ellipsis: content wider than the box, box hides it.
      const cs = getComputedStyle(el);
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== "visible" && cs.textOverflow !== "ellipsis") clipped.push(name(el));
      // Text spilling out of its own box (it overlaps whatever is next to it).
      if (hasText && cs.display !== "inline" && el.clientWidth > 0 && cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 1) clipped.push(`spill ${name(el)}`);
      // Text pushed outside a parent that hides overflow.
      if (hasText) {
        for (let p = el.parentElement; p && p.id !== "app"; p = p.parentElement) {
          const pc = getComputedStyle(p);
          if (pc.overflowX === "hidden" || pc.overflow === "hidden") {
            const pr = p.getBoundingClientRect();
            if (r.right > pr.right + 1 && cs.textOverflow !== "ellipsis") clipped.push(`${name(el)} in ${name(p)}`);
            break;
          }
        }
      }
    }
    const small = [...document.querySelectorAll("#app button, #app a[href], #app [role=button], #app [role=radio], #app input[type=checkbox], #app select")]
      .filter((el) => vis(el) && !el.classList.contains("link") && !el.closest("p"))
      .map((el) => {
        const host = el.matches("input") && el.closest("label") ? el.closest("label") : el;
        const r = host.getBoundingClientRect();
        // A chip may be drawn smaller than its touch area (an absolutely placed ::before).
        const pre = getComputedStyle(el, "::before");
        const grow = pre.position === "absolute" && pre.content !== "none" ? -2 * parseFloat(pre.top || "0") : 0;
        return { el, w: r.width, h: r.height + Math.max(0, grow) };
      })
      .filter((x) => x.h < 47.5 || x.w < 47.5)
      .map((x) => `${name(x.el)} ${Math.round(x.w)}x${Math.round(x.h)}`);
    const sizes = [...new Set([...document.querySelectorAll("#app *")].filter(vis).filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((el) => getComputedStyle(el).fontSize))];
    return { docOver: document.documentElement.scrollWidth - vw, over: [...new Set(over)].slice(0, 8), clipped: [...new Set(clipped)].slice(0, 8), small: [...new Set(small)].slice(0, 8), sizes };
  });
}
const report = [];
async function shot(screen, tag, opts = {}) {
  await settle(450);
  const m = await measure();
  const file = join(OUT, `${screen}__${tag}.png`);
  await page.screenshot({ path: file, fullPage: false });
  report.push({ screen, tag, ...m });
  const bad = m.docOver > 0 || m.over.length || m.clipped.length;
  console.log(`${bad ? "ISSUE" : "ok   "} ${screen} ${tag} over=${m.docOver} els=${m.over.length} clip=${m.clipped.length} small=${m.small.length} sizes=${m.sizes.length}`);
}

// ---------- one wallet with long names and real coins ----------
await page.goto(`http://localhost:${PORT}/index.html`);
await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 90000 });
await settle(1500);
await page.evaluate(async () => {
  localStorage.setItem("privatebit.theme", "dark");
  await chrome.storage.local.set({ "privatebit.theme": "dark" });
});
await page.reload();
await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 90000 });
await settle(1200);
await shot("welcome", "dark-412-1");
await tap('[data-act="go"][data-to="create-password"]');
await page.fill("#pw", PW);
await page.fill("#pw2", PW);
await page.fill("#wname", "Everyday spending wallet");
await settle(200);
await shot("create", "dark-412-1");
await tap('[data-act="pw-continue"]', 1500);
await page.waitForSelector('[data-act="reveal"]', { timeout: 60000 });
await tap('[data-act="reveal"]');
await shot("seed", "dark-412-1");
const words = (await send({ type: "ONBOARD_GET" })).data.mnemonic.split(" ");
await tap('[data-act="to-verify"]');
const legends = await page.locator("fieldset legend").allInnerTexts();
for (let i = 0; i < legends.length; i++) {
  const n = Number(legends[i].replace(/\D/g, ""));
  await tap(`[data-act="pick"][data-i="${i}"][data-w="${words[n - 1]}"]`, 250);
}
await shot("verify", "dark-412-1");
await tap('[data-act="finish-create"]', 2500);
await page.waitForSelector('[data-act="open-wallet"]', { timeout: 90000 });
await settle(800);
await shot("ready-offer", "dark-412-1");
await tap('[data-act="bio-offer-skip"]', 500).catch(() => undefined);
await tap('[data-act="open-wallet"]', 1500);
await send({ type: "PREFS_SET", prefs: { priceSource: "off" } });
await page.evaluate(`self.__pbE2E.fundOpenWallet("1234567890", "Salary from the long company name")`);
await page.evaluate(`self.__pbE2E.fundOpenWallet("250000", "Shop")`);
await page.evaluate(`self.__pbE2E.fundOpenWallet("99990000")`);
await page.evaluate(`self.__pbE2E.fundOpenWallet("12000")`);

const SCREENS = [
  ["home", async () => act({ act: "go", to: "home" }, 1200)],
  ["activity", async () => act({ act: "go", to: "activity" }, 1000)],
  ["activity-detail", async () => { await act({ act: "go", to: "activity" }, 900); await tap("#app .li[data-act]", 900); }],
  ["coins", async () => act({ act: "go", to: "coins" }, 1000)],
  ["coin-detail", async () => { await act({ act: "go", to: "coins" }, 900); await tap('#app [data-to="coin-detail"]', 900); }],
  ["receive", async () => act({ act: "go", to: "receive" }, 1000)],
  ["send", async () => { await act({ act: "go", to: "send" }, 800); await page.fill("#to", "bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.00012"); await settle(500); }],
  ["review", async () => { await tap('[data-act="review"]', 2500); await page.waitForSelector('[data-sheet="confirm"]', { timeout: 60000 }); }],
  ["confirm-sheet", async () => { for (const f of ["ackMerge", "ack"]) if (await page.locator(`[data-f="${f}"]`).count()) await tap(`label.check:has([data-f="${f}"])`, 300); await tap('[data-sheet="confirm"]', 900); }],
  ["paylink", async () => { await act({ act: "sheet-close" }, 300); await act({ act: "go", to: "paylink" }, 1000); }],
  ["settings", async () => act({ act: "go", to: "settings" }, 900)],
  ["wallets", async () => act({ act: "go", to: "wallets" }, 900)],
  ["set-security", async () => { await dev({ bioOn: false, bio: "yes" }); await act({ act: "go", to: "set-security" }, 900); }],
  ["set-security-bio-on", async () => { await dev({ bioOn: true }); await act({ act: "go", to: "home" }, 300); await act({ act: "go", to: "set-security" }, 900); }],
  ["set-security-no-sensor", async () => { await dev({ bio: "none", bioOn: false }); await act({ act: "go", to: "home" }, 300); await act({ act: "go", to: "set-security" }, 900); await dev({ bio: "yes", bioOn: true }); }],
  ["set-notify-off", async () => { await page.evaluate(() => localStorage.removeItem("pb.notify")); await act({ act: "go", to: "set-notify" }, 900); }],
  ["set-notify-on", async () => { await tap("label[for=nt-on]", 900); }],
  ["set-notify-how", async () => { await page.evaluate(() => { const d = document.querySelector("#app details.card"); if (d) { d.open = true; d.scrollIntoView({ block: "start" }); } }); await settle(300); }],
  ["set-privacy", async () => act({ act: "go", to: "set-privacy" }, 900)],
  ["set-network", async () => act({ act: "go", to: "set-network" }, 900)],
  ["set-scan", async () => act({ act: "go", to: "set-scan" }, 900)],
  ["set-appearance", async () => act({ act: "go", to: "set-appearance" }, 900)],
  ["browser", async () => act({ act: "go", to: "browser" }, 900)],
  ["unlock", async () => { await dev({ bioOn: true, unlockCode: "cancelled" }); await send({ type: "LOCK" }); await page.reload(); await page.waitForSelector("#pw", { timeout: 60000 }); await settle(800); }],
  ["unlock-after-restart", async () => { await dev({ unlockCode: "restart" }); await tap('[data-act="bio-unlock"]', 600); await page.evaluate(() => document.activeElement?.blur()); await dev({ unlockCode: "cancelled" }); }],
];
async function dev(patch) {
  await page.evaluate((p) => localStorage.setItem("e2e.dev", JSON.stringify({ ...JSON.parse(localStorage.getItem("e2e.dev") || "{}"), ...p })), patch);
}
async function unlock() {
  if (!(await page.locator("#pw").count())) return;
  await page.fill("#pw", PW);
  await tap('[data-act="unlock"]', 1500);
  await page.waitForFunction(() => !document.querySelector("#pw"), null, { timeout: 60000 });
  await settle(600);
}
for (const fs of SCALES) {
  await setScale(fs);
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const h = w >= 768 ? 1280 : w <= 320 ? 640 : 800;
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate(async (t) => {
        localStorage.setItem("privatebit.theme", t);
        await chrome.storage.local.set({ "privatebit.theme": t });
      }, theme);
      await page.reload();
      await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 90000 });
      await settle(900);
      await unlock();
      await simTextZoom(fs);
      const tag = `${theme}-${w}-${fs}`;
      for (const [screen, go] of SCREENS) {
        try {
          await go();
          await simTextZoom(fs);
          await shot(screen, tag);
        } catch (e) {
          console.log(`SKIP ${screen} ${tag}: ${String(e.message).slice(0, 120)}`);
          await unlock().catch(() => undefined);
        }
      }
      await unlock();
    }
  }
}
writeFileSync(join(OUT, "report.json"), JSON.stringify({ sim: SIM, errors, report }, null, 2));
const issues = report.filter((r) => r.docOver > 0 || r.over.length || r.clipped.length);
console.log(`\n${report.length} screens, ${issues.length} with overflow or clipped text, ${report.filter((r) => r.small.length).length} with targets under 48 px, page errors ${errors.length}`);
await ctx.close();
process.exit(0);
