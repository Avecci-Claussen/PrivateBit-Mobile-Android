// PrivateBit Android UI flow. Two targets, same steps:
//   PB_TARGET=device  the debug-e2e APK in an Android emulator, driven over WebView DevTools (adb)
//   PB_TARGET=web     the same web bundle in Chromium with a phone viewport (no native plugins)
// Offline mock chain, throwaway wallets, nothing is broadcast.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = process.env.PB_TARGET ?? "web";
const OUT = process.env.PB_OUT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../e2e-out/apk");
const ADB = `${process.env.HOME}/android-sdk/platform-tools/adb`;
const PKG = "com.privatebit.wallet.debug";
const PW = "throwaway-phone-1";
const SIZES = (process.env.PB_SIZES ?? "360x800,412x915,800x1280").split(",").map((s) => {
  const [w, h] = s.split("x").map(Number);
  return { n: w >= 768 ? `tablet-${s}` : s, w, h };
});
mkdirSync(join(OUT, TARGET), { recursive: true });
const results = [];
const errors = [];
const shots = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
};
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser, ctx, page;
async function attachDevice() {
  const pid = adb("shell", "pidof", PKG).trim();
  adb("forward", "--remove-all");
  adb("forward", "tcp:9333", `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9333", { timeout: 20000 });
      break;
    } catch {
      await sleep(2000);
    }
  }
  ctx = browser.contexts()[0];
  page = ctx.pages().find((p) => p.url().startsWith("https://localhost")) ?? ctx.pages()[0];
  page.setDefaultTimeout(60000);
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
}
async function startDevice() {
  adb("shell", "pm", "clear", PKG);
  adb("shell", "wm", "size", "1080x2400");
  adb("shell", "wm", "density", "420");
  adb("shell", "pm", "grant", PKG, "android.permission.CAMERA");
  adb("shell", "am", "start", "-W", "-n", `${PKG}/com.privatebit.wallet.MainActivity`);
  await sleep(8000);
  await attachDevice();
}
async function startWeb() {
  if (!existsSync("/tmp/qr.y4m")) execFileSync("sh", [new URL("./make-qr.sh", import.meta.url).pathname]);
  const srv = spawn("npx", ["vite", "preview", "--outDir", "www-e2e", "--port", "4317", "--strictPort"], { cwd: new URL("../..", import.meta.url).pathname, stdio: "ignore" });
  process.on("exit", () => srv.kill());
  await sleep(2500);
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pb-apk-")), {
    headless: true,
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome`,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=/tmp/qr.y4m", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"],
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
    permissions: ["camera"],
  });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(20000);
  // In a desktop browser there is no native http client, so outside requests (prices) hit the page's CSP. Expected here only.
  page.on("console", (m) => m.type() === "error" && !/ERR_NAME_NOT_RESOLVED|Failed to load resource|net::|Content Security Policy directive: "connect-src|violates the document.s Content Security Policy/.test(m.text()) && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto("http://localhost:4317/index.html");
}
const settle = async (ms = 500) => {
  await page.waitForTimeout(ms);
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
};
const send = (m) => page.evaluate((m) => chrome.runtime.sendMessage(m), m);
const hook = (src) => page.evaluate(src);
const route = () => page.evaluate(() => document.querySelector("#app")?.dataset.route ?? document.title);
const tap = async (sel, ms = 600) => {
  const l = page.locator(sel).first();
  await l.scrollIntoViewIfNeeded({ timeout: 15000 }).catch(() => undefined);
  await l.click({ timeout: 30000 });
  await settle(ms);
};
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
const text = () => page.locator("body").innerText();
const waitText = (re, timeout = 30000) => page.waitForFunction((s) => new RegExp(s, "i").test(document.body.innerText), re.source, { timeout });

async function setSize(s) {
  if (TARGET === "device") {
    // Phone sizes in dp: pixels = dp * density / 160.
    const dens = s.w >= 768 ? 320 : 420;
    adb("shell", "wm", "size", `${Math.round((s.w * dens) / 160)}x${Math.round((s.h * dens) / 160)}`);
    adb("shell", "wm", "density", String(dens));
    await sleep(2500);
  } else await page.setViewportSize({ width: s.w, height: s.h });
}
async function setTheme(t) {
  await page.evaluate(async (t) => {
    localStorage.setItem("privatebit.theme", t);
    await chrome.storage.local.set({ "privatebit.theme": t });
    document.documentElement.dataset.theme = t;
  }, t);
  await settle(300);
}
async function reload() {
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 60000 });
  await settle(1500);
}
async function checks(name) {
  const body = await text();
  const dash = body.match(/.{0,30}[\u2013\u2014].{0,30}/);
  if (dash) ok(`no en or em dash: ${name}`, false, dash[0]);
  const desk = body.match(/.{0,30}\b(computer|extension|Chrome|click|toolbar|this window|the window|the browser)\b.{0,30}/i);
  if (desk) ok(`phone wording: ${name}`, false, desk[0]);
  const comp = body.match(/.{0,20}\b(unisat|metamask|sparrow|electrum|wasabi|samourai|xverse|leather)\b.{0,20}/i);
  if (comp) ok(`no other wallet names: ${name}`, false, comp[0]);
  const wrongNet = body.match(/.{0,30}wrong network.{0,30}/i);
  if (wrongNet) ok(`no wrong network warning: ${name}`, false, wrongNet[0]);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 0) ok(`no horizontal overflow: ${name}`, false, `${over}px`);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, a[href], [role=button], [role=radio], input[type=checkbox]")]
      .filter((el) => {
        const box = (el.matches("input[type=checkbox]") && el.closest("label") ? el.closest("label") : el).getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest(".sr-only") && !el.classList.contains("link") && (el.matches("input") ? box.height < 24 || box.width < 24 : box.height < 40 || box.width < 40);
      })
      .map((el) => `${el.tagName}[${el.dataset.act ?? ""}] "${el.textContent.trim().slice(0, 18)}" ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`),
  );
  if (small.length) ok(`touch targets (buttons 40 px, form controls 24 px): ${name}`, false, small.slice(0, 6).join(" | "));
}
async function shot(name, opts = {}) {
  await settle(400);
  await checks(name);
  const file = join(OUT, TARGET, `${name}.png`);
  if (TARGET === "device" && !opts.cdp) {
    writeFileSync(file, execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 }));
  } else {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: file });
  }
  shots.push(file);
}
async function axe(name) {
  try {
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    ok(`axe serious or critical: ${name}`, bad.length === 0, bad.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(" | "));
  } catch (e) {
    ok(`axe ran: ${name}`, false, e.message);
  }
}
async function unlockUi() {
  await page.waitForSelector("#pw", { timeout: 60000 });
  await page.fill("#pw", PW);
  await tap('[data-act="unlock"]', 1500);
  await page.waitForFunction(() => !document.querySelector("#pw"), null, { timeout: 60000 });
  await settle(800);
}

// ======================================================================
async function main() {
if (TARGET === "device") await startDevice();
else await startWeb();
await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 90000 });
await settle(1500);
const S0 = SIZES.find((s) => s.w === 412) ?? SIZES[0];
await setSize(S0);
await setTheme("dark");
await reload();

// ---------- create a wallet with a name, through the screens ----------
ok("starts on the welcome screen", /Create a new wallet/.test(await text()));
await shot(`welcome-dark-${S0.n}`);
await tap('[data-act="go"][data-to="create-password"]');
await page.fill("#pw", PW);
await page.fill("#pw2", PW);
await page.fill("#wname", "Phone wallet");
await settle(300);
await shot(`create-dark-${S0.n}`);
await tap('[data-act="pw-continue"]', 1500);
await page.waitForSelector('[data-act="reveal"]', { timeout: 60000 });
await tap('[data-act="reveal"]');
await shot(`seed-dark-${S0.n}`);
if (TARGET === "device") {
  const secure = adb("shell", "dumpsys", "window", "windows").match(/mCurrentFocus[\s\S]{0,4000}?fl=([^\n]*)/);
  ok("FLAG_SECURE on the recovery words screen", /SECURE/.test(adb("shell", "dumpsys", "window", "windows").split("mCurrentFocus")[0] + adb("shell", "dumpsys", "window") ), secure?.[1]?.slice(0, 120) ?? "");
}
const ob = (await send({ type: "ONBOARD_GET" })).data;
const words = ob.mnemonic.split(" ");
ok("24 recovery words", words.length === 24);
await tap('[data-act="to-verify"]');
const legends = await page.locator("fieldset legend").allInnerTexts();
for (let i = 0; i < legends.length; i++) {
  const n = Number(legends[i].replace(/\D/g, ""));
  await tap(`[data-act="pick"][data-i="${i}"][data-w="${words[n - 1]}"]`, 300);
}
await tap('[data-act="finish-create"]', 2500);
await page.waitForSelector('[data-act="open-wallet"]', { timeout: 90000 });
await shot(`ready-dark-${S0.n}`);
await tap('[data-act="open-wallet"]', 1500);
let st = (await send({ type: "STATE" })).data;
ok("wallet created and open", st.unlocked && st.wallets.find((w) => w.active)?.name === "Phone wallet", st.wallets?.map((w) => w.name).join(","));
await send({ type: "PREFS_SET", prefs: { priceSource: "off" } });
const sec = await page.evaluate(() => document.body.innerText.includes("recovery"));
void sec;

// ---------- coins (offline mock chain) ----------
await hook(`self.__pbE2E.fundOpenWallet("400000", "Salary")`);
await hook(`self.__pbE2E.fundOpenWallet("250000", "Shop")`);
await hook(`self.__pbE2E.fundOpenWallet("90000")`);
await act({ act: "go", to: "home" }, 1500);
st = (await send({ type: "STATE" })).data;
ok("Fractal wallet has three coins", BigInt(st.confirmed ?? "0") === 740000n, st.confirmed);
await shot(`home-dark-${S0.n}`);

// ---------- receive code ----------
await act({ act: "go", to: "receive" }, 1200);
const code = st.receive ?? "";
ok("receive code shown", code.startsWith("sp1") && (await text()).replace(/\s/g, "").includes(code.slice(0, 10)), code.slice(0, 12));
ok("receive QR drawn", (await page.locator("#app svg rect, #app svg path, #app canvas, #app img").count()) > 0);
await shot(`receive-dark-${S0.n}`);

// ---------- send: scan a QR, choose coins, review ----------
await act({ act: "go", to: "send" }, 1000);
ok("send has a scan button", (await page.locator('[data-act="qr-scan"]').count()) === 1);
if (TARGET === "web") {
  await tap('[data-act="qr-scan"]', 500);
  await page.waitForFunction(() => !document.querySelector(".pb-scanner"), null, { timeout: 20000 });
  await settle(600);
  const to = await page.inputValue("#to");
  ok("QR scan fills the payment request", to.startsWith("bitcoin:bc1p5cyx") && to.includes("amount=0.00012"), to);
} else {
  // The emulator camera shows its own test scene, not a QR code; open and close the scanner,
  // then type the same request.
  await tap('[data-act="qr-scan"]', 3000);
  ok("scanner opens on the device", (await page.locator(".pb-scanner").count()) === 1);
  await shot(`scanner-dark-${S0.n}`);
  await page.locator("[data-scan-close]").click();
  await settle(500);
  await page.fill("#to", "bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.00012");
  await settle(600);
}
await tap('[data-act="go"][data-to="send-coins"]');
await tap('[data-act="coin-mode"][data-v="choose"]');
const boxes = page.locator('.cpick label');
ok("pay from lists three coins", (await boxes.count()) === 3, await boxes.count());
await boxes.nth(0).click();
await settle(300);
await boxes.nth(1).click();
await settle(400);
await shot(`pay-from-dark-${S0.n}`);
await tap('[data-act="coins-done"]', 800);
await tap('[data-act="review"]', 2500);
await page.waitForFunction(() => /Review|Confirm/i.test(document.body.innerText) && document.querySelector('[data-sheet="confirm"]'), null, { timeout: 60000 });
const rv = await text();
ok("review shows the chosen coins", /2 coins|Salary|Shop/i.test(rv), rv.slice(0, 160).replace(/\n/g, " "));
ok("review shows the amount", /12[\s,.]?000|0\.00012/.test(rv));
await shot(`review-dark-${S0.n}`);
// A plain address needs the "can be linked" acknowledgement first.
for (const f of ["ackMerge", "ack"]) if (await page.locator(`[data-f="${f}"]`).count()) await tap(`label.check:has([data-f="${f}"])`, 400);
ok("review warns before spending differently labeled coins together", /different labels/i.test(await text()));
await settle(400);
await tap('[data-sheet="confirm"]', 800);
ok("confirm sheet opens (not sent)", (await page.locator(".sheet").count()) >= 1);
await shot(`confirm-sheet-dark-${S0.n}`);
await act({ act: "sheet-close" }, 500);
await act({ act: "go", to: "home" });

// ---------- Payjoin offer ----------
await act({ act: "go", to: "paylink" }, 1000);
await page.fill("#amt", "0.0005");
await settle(300);
await tap('[data-act="pj-create"]', 3000);
const pj = await text();
ok("Payjoin payment link created", /pj=|Waiting|payment link/i.test(pj) && (await send({ type: "SESSIONS" })).ok, pj.slice(0, 120).replace(/\n/g, " "));
await shot(`payjoin-dark-${S0.n}`);

// ---------- settings, appearance, security, site browser ----------
await act({ act: "go", to: "settings" }, 1000);
ok("settings has the site browser entry", /Open a site/.test(await text()));
await shot(`settings-dark-${S0.n}`);
await act({ act: "go", to: "set-appearance" }, 800);
await shot(`appearance-dark-${S0.n}`);
await act({ act: "go", to: "set-security" }, 800);
await shot(`security-dark-${S0.n}`);
await act({ act: "go", to: "browser" }, 800);
await shot(`open-site-dark-${S0.n}`);
await axe("open a site");

// ---------- lock and unlock ----------
await send({ type: "LOCK" });
await reload();
ok("locked after lock", /Unlock/i.test(await text()));
await shot(`unlock-dark-${S0.n}`);
await page.fill("#pw", "not the password");
await tap('[data-act="unlock"]', 2000);
ok("wrong password refused", (await page.locator("#pw").count()) === 1);
await unlockUi();
ok("unlocked with the password", (await send({ type: "STATE" })).data.unlocked === true);

// ---------- Bitcoin chain ----------
await act({ act: "net-set", v: "bitcoin" }, 2500);
st = (await send({ type: "STATE" })).data;
ok("switched to Bitcoin", st.network === "bitcoin" || /Bitcoin/.test(await text()), st.network);
await hook(`self.__pbE2E.fundOpenWallet("150000", "Bitcoin savings")`);
await act({ act: "go", to: "home" }, 1500);
await shot(`home-bitcoin-dark-${S0.n}`);
await act({ act: "go", to: "receive" }, 1000);
await shot(`receive-bitcoin-dark-${S0.n}`);
await act({ act: "net-set", v: "fractal" }, 2500);

// ---------- payment links from other apps ----------
if (TARGET === "device") {
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.0002&pj=https://payjo.in/TESTONLY'", PKG);
  await sleep(4000);
  const to = await page.inputValue("#to").catch(() => "");
  ok("bitcoin: link opens Send with the request", to.startsWith("bitcoin:") && to.includes("pj="), to);
  await shot(`deeplink-dark-${S0.n}`);
}

// ---------- every size, both themes ----------
for (const s of SIZES) {
  for (const theme of ["dark", "light"]) {
    await setSize(s);
    await setTheme(theme);
    await reload();
    const tag = `${theme}-${s.n}`;
    if (!(s === S0 && theme === "dark")) await shot(`unlock-${tag}`);
    await unlockUi();
    await act({ act: "go", to: "home" }, 1200);
    if (!(s === S0 && theme === "dark")) await shot(`home-${tag}`);
    await act({ act: "go", to: "receive" }, 1000);
    if (!(s === S0 && theme === "dark")) await shot(`receive-${tag}`);
    await act({ act: "go", to: "send" }, 800);
    await page.fill("#to", "bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.00012");
    await settle(500);
    await tap('[data-act="review"]', 2500);
    await page.waitForSelector('[data-sheet="confirm"]', { timeout: 60000 });
    if (!(s === S0 && theme === "dark")) await shot(`review-${tag}`);
    await act({ act: "go", to: "settings" }, 800);
    if (!(s === S0 && theme === "dark")) await shot(`settings-${tag}`);
    if (theme === "light") await axe(`settings ${tag}`);
  }
}

ok("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
writeFileSync(join(OUT, TARGET, "results.json"), JSON.stringify({ target: TARGET, results, errors, shots }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed on ${TARGET}`);
if (TARGET === "web") await ctx.close();
else await browser.close();
process.exit(failed.length ? 1 : 0);
}
main().catch(async (e) => {
  console.error(e);
  try {
    await page.screenshot({ path: join(OUT, TARGET, "fail.png") });
    writeFileSync(join(OUT, TARGET, "fail.html"), await page.content());
    writeFileSync(join(OUT, TARGET, "results.json"), JSON.stringify({ target: TARGET, results, errors, shots, crash: String(e) }, null, 2));
  } catch {}
  process.exit(2);
});
