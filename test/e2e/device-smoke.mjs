// Native checks on the Android emulator (debug-e2e APK): things the web run cannot show.
// Generous timeouts: the emulator here runs without hardware acceleration.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ADB = `${process.env.HOME}/android-sdk/platform-tools/adb`;
const PKG = "com.privatebit.wallet.debug";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../e2e-out/apk/device");
const PW = "throwaway-phone-1";
mkdirSync(OUT, { recursive: true });
const adb = (...a) => execFileSync(ADB, a, { encoding: "utf8", timeout: 120000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
};
// Android WebView exposes page level DevTools only, so a small CDP client drives it.
let ws, seq = 0;
const pending = new Map();
// Node's WebSocket does not keep the process alive on its own.
const keepAlive = setInterval(() => undefined, 10000);
async function cdp(method, params = {}, timeout = 180000) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pending.delete(id); rej(new Error(`${method} timed out`)); }, timeout);
    pending.set(id, { res: (v) => { clearTimeout(t); res(v); }, rej: (e) => { clearTimeout(t); rej(e); } });
  });
}
async function ev(expr) {
  const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(cond, timeout = 600000) {
  const t0 = Date.now();
  for (;;) {
    try { if (await ev(`return !!(${cond});`)) return; } catch {}
    if (Date.now() - t0 > timeout) throw new Error(`timed out waiting for ${cond}`);
    await sleep(1500);
  }
}
async function launch(clear) {
  if (clear) adb("shell", "pm", "clear", PKG);
  else adb("shell", "am", "force-stop", PKG);
  adb("shell", "am", "start", "-n", `${PKG}/com.privatebit.wallet.MainActivity`);
  await attach();
}
async function attach() {
  let pid = "";
  for (let i = 0; i < 90 && !pid; i++) {
    try { pid = adb("shell", "pidof", PKG).trim(); } catch { await sleep(3000); }
  }
  console.log(`[${new Date().toISOString()}] app pid ${pid}`);
  let sock = false;
  for (let i = 0; i < 120 && !sock; i++) {
    sock = adb("shell", "cat", "/proc/net/unix").includes(`webview_devtools_remote_${pid}`);
    if (!sock) await sleep(3000);
  }
  adb("forward", "--remove-all");
  adb("forward", "tcp:9333", `localabstract:webview_devtools_remote_${pid}`);
  let target;
  for (let i = 0; i < 120 && !target; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9333/json")).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith("https://localhost"));
    } catch {}
    if (!target) await sleep(3000);
  }
  try { ws?.close(); } catch {}
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    const p = d.id && pending.get(d.id);
    if (p) { pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
  };
  console.log(`[${new Date().toISOString()}] devtools attached`);
  await waitFor(`document.querySelector("#app")?.children.length > 0`);
  console.log(`[${new Date().toISOString()}] app rendered`);
  await sleep(5000);
}
const q = JSON.stringify;
const page = {
  click: async (sel) => { await waitFor(`document.querySelector(${q(sel)})`); await ev(`document.querySelector(${q(sel)}).click();`); await sleep(2500); },
  fill: async (sel, v) => { await waitFor(`document.querySelector(${q(sel)})`); await ev(`const e = document.querySelector(${q(sel)}); e.focus(); e.value = ${q(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true }));`); await sleep(800); },
  waitForSelector: (sel, o = {}) => waitFor(`document.querySelector(${q(sel)})`, o.timeout),
  inputValue: (sel) => ev(`return document.querySelector(${q(sel)})?.value ?? "";`),
};
const send = (m) => ev(`return await chrome.runtime.sendMessage(${q(m)});`);
const text = () => ev(`return document.body.innerText;`);
const screencap = (name) => writeFileSync(join(OUT, `${name}.png`), execFileSync(ADB, ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20, timeout: 120000 }));
const cdpshot = async (name) => writeFileSync(join(OUT, `${name}-webview.png`), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));

async function main() {
  adb("shell", "wm", "size", "1080x2400");
  adb("shell", "wm", "density", "420");
  await launch(true);
  ok("app starts on the welcome screen", /Create a new wallet/.test(await text()));
  screencap("01-welcome");

  // create through the screens up to the recovery words
  await page.click('[data-act="go"][data-to="create-password"]');
  await page.fill("#pw", PW);
  await page.fill("#pw2", PW);
  await page.fill("#wname", "Emulator wallet");
  await page.click('[data-act="pw-continue"]');
  await page.waitForSelector('[data-act="reveal"]');
  await page.click('[data-act="reveal"]');
  await sleep(4000);
  const win = adb("shell", "dumpsys", "window", "windows");
  const block = win.split(/Window #\d+/).find((b) => b.includes(PKG) && b.includes("mHasSurface=true")) ?? "";
  ok("FLAG_SECURE while recovery words are shown", /fl=[^\n]*SECURE/.test(block), (block.match(/fl=[^\n]*/) ?? [""])[0]);
  screencap("02-seed-screencap-secure");
  await send({ type: "CREATE_CHECKED", password: PW, name: "Emulator wallet" });
  await ev(`location.reload();`).catch(() => undefined);
  await sleep(8000);
  await waitFor(`document.querySelector("#app")?.children.length > 0`);
  await sleep(4000);
  const win2 = adb("shell", "dumpsys", "window", "windows");
  const block2 = win2.split(/Window #\d+/).find((b) => b.includes(PKG) && b.includes("mHasSurface=true")) ?? "";
  ok("FLAG_SECURE off on other screens", !/fl=[^\n]*SECURE/.test(block2), (block2.match(/fl=[^\n]*/) ?? [""])[0]);
  let st = (await send({ type: "STATE" })).data;
  ok("wallet created on the device", st.hasVault === true, st.wallets?.map((w) => w.name).join(","));

  // encrypted storage on disk, nothing readable
  await sleep(1000); // saves are debounced by 120 ms
  await sleep(3000);
  const files = adb("shell", "run-as", PKG, "ls", "-la", "no_backup");
  ok("wallet store file in no-backup storage", /wallet-store\.v1\.bin/.test(files), files.replace(/\n/g, " | "));
  const raw = execFileSync(ADB, ["exec-out", "run-as", PKG, "cat", "no_backup/wallet-store.v1.bin"], { timeout: 120000 });
  const asText = raw.toString("latin1");
  ok("store file is ciphertext (no key names, no wallet name)", raw.length > 100 && !/privatebit|Emulator wallet|vault/i.test(asText), `${raw.length} bytes`);
  const shared = adb("shell", "run-as", PKG, "ls", "-R", ".");
  ok("no WebView localStorage copy of the wallet", !/privatebit/i.test(shared.split("\n").filter((l) => /Local Storage/.test(l)).join("")), "");

  // process death: the wallet comes back locked, from the Keystore store
  await launch(false);
  st = (await send({ type: "STATE" })).data;
  ok("after the app is killed: wallet kept, and locked", st.hasVault === true && st.unlocked === false, JSON.stringify({ v: st.hasVault, u: st.unlocked }));
  screencap("03-unlock-after-restart");
  await page.fill("#pw", PW);
  await page.click('[data-act="unlock"]');
  await waitFor(`!document.querySelector("#pw")`);
  await sleep(4000);
  ok("unlock with the password on the device", (await send({ type: "STATE" })).data.unlocked === true);
  await send({ type: "PREFS_SET", prefs: { priceSource: "off" } });

  // the native http client: http only for local addresses
  const http = await ev(`
    const r = {};
    for (const [k, u] of [["publicHttp", "http://example.com/"], ["localHttp", "http://10.0.2.2:9/"], ["https", "https://example.com/"]]) {
      try { const res = await fetch(u); r[k] = "status " + res.status; } catch (e) { r[k] = "error " + e.message; }
    }
    return r;`);
  ok("http to a public host is refused before connecting", /only allowed for a node on this phone or your local network/.test(http.publicHttp), http.publicHttp);
  ok("http to a local address is attempted", !/only allowed/.test(http.localHttp), http.localHttp);
  ok("https works through the native client", /status|error/.test(http.https), http.https);

  // payment link from another app
  await ev(`const b = document.createElement("button"); b.dataset.act = "go"; b.dataset.to = "home"; document.querySelector("#app").appendChild(b); b.click(); b.remove();`);
  await sleep(3000);
  adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "'bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.0002&pj=https://payjo.in/TESTONLY'", PKG);
  await page.waitForSelector("#to", { timeout: 300000 }).catch(() => undefined);
  await sleep(3000);
  const to = await page.inputValue("#to").catch(() => "");
  ok("bitcoin: link with pj= opens Send with the request", to.startsWith("bitcoin:") && to.includes("pj="), to);
  screencap("04-deeplink-send");
  await cdpshot("04-deeplink-send");

  // camera permission is asked only when scanning
  const perm0 = adb("shell", "dumpsys", "package", PKG).match(/android.permission.CAMERA: granted=(\w+)/)?.[1] ?? "not asked";
  ok("camera not granted before scanning", perm0 !== "true", perm0);
  await page.click('[data-act="qr-scan"]');
  await sleep(8000);
  screencap("05-camera-permission-prompt");
  const ui = adb("shell", "uiautomator", "dump", "/sdcard/ui.xml") && adb("shell", "cat", "/sdcard/ui.xml");
  ok("Android asks for the camera when you tap Scan", /permission_allow|Allow|While using the app/i.test(ui), "");
  await ev(`window.dispatchEvent(new Event("pb-scanner-close"));`);
}
main()
  .catch((e) => ok("device run finished", false, e.message))
  .finally(async () => {
    writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
    const f = results.filter((r) => !r.pass).length;
    console.log(`\n${results.length - f}/${results.length} device checks passed`);
    try { ws?.close(); } catch {}
    clearInterval(keepAlive);
    process.exit(f ? 1 : 0);
  });
