/**
 * Phone and tablet shell around the shared screens: layout mode, Android back button, payment
 * links opened from other apps, QR scanning, FLAG_SECURE on secret screens, system bar colors and
 * the in-app site browser. Fingerprint or face unlock is in bio.ts, notifications in notify.ts.
 */
import { App } from "@capacitor/app";
import { SystemBars, SystemBarsStyle } from "@capacitor/core";
import { S, screens, actions, go, back, render, setRenderer, toast, type View } from "../shared/src/ui/app.ts";
import { popupHtml, fullHtml } from "../shared/src/ui/chrome.ts";
import { html, raw, I, type Safe } from "../shared/src/ui/kit.ts";
import { start } from "../shared/src/ui/main.ts";
import { DeviceSecurity, isNative } from "./shim/native.ts";
import { installBio, bioRoute } from "./bio.ts";
import { installNotify, takeTxLink, applyTxLink } from "./notify.ts";
import { ready, storeStatus } from "./shim/storage.ts";
import { openScanner } from "./scan.ts";
import { installBrowser } from "./browser.ts";
import { applyFontScale, fontScaleFromAgent } from "./textscale.ts";

const SECRET_ROUTES = new Set(["seed", "verify", "import", "set-backup"]);
const TABLET = 768;

/** The extension says "computer" and "click"; on a phone the same sentences say phone and tap. */
const WORDING: [RegExp, string][] = [
  [/this computer/g, "this phone"],
  [/This computer/g, "This phone"],
  [/your computer/g, "your phone"],
  [/on this computer/g, "on this phone"],
  [/until you quit the browser or switch wallets/g, "while the app is open, and again when you come back to it"],
  [/your last click or key press/g, "the last time you used the app"],
  [/click or key press/g, "tap"],
  [/until you switch or quit the browser/g, "until you switch wallets or close the app"],
  [/quit the browser/g, "close the app"],
  [/across lock and closing the window/g, "across lock and closing the app"],
  [/when you were at your computer/g, "when you were using your phone"],
  [/even if you lock or close the window, and you can send it now or cancel it until then\./g, "even if you lock. PrivateBit sends it while the app is open; if the app is closed at that time, it goes the next time you open it. You can send it now or cancel it until then."],
  [/Reloading the extension does not delete it\./g, "It is still stored in this app."],
  [/The extension just reloaded\./g, "The app just restarted."],
  [/<p class="small muted">Chrome asks once to allow access to [^<]*<\/p>/g, ""],
  // The extension's screens can close while its background keeps working. In the app they are one
  // process, so the app has to stay open (it may run in the background until Android closes it).
  [/Closing the window is fine\. Quitting the browser ends the link\./g, "Closing PrivateBit ends the link, so keep it open until they pay."],
  [/You can close this window or lock/g, "You can lock"],
  [/Quitting the browser stops it\./g, "Closing PrivateBit stops it."],
  [/Needed only for a mailbox other than payjo\.in in the browser\. The mailbox then sees your IP once a week\. The Android app fetches them through the relay instead\./g, "The app fetches mailbox keys through the relay. Turn this on only if the relay cannot reach your mailbox; the mailbox then sees your IP once a week."],
  [/Their wallet did not send anything\. Closing the window is fine\./g, "Their wallet did not send anything."],
  [/Closing this window is fine\./g, "Keep PrivateBit open until it finishes."],
  [/Closing this window keeps going\./g, "It continues while PrivateBit is open and catches up when you come back."],
  [/You can close this window\. Do not lock\./g, "Keep PrivateBit open and do not lock."],
  [/even if you close this window or lock\./g, "even if you lock, while PrivateBit is open. If the app is closed then, it goes the next time you open it."],
  [/Closing the window is fine\./g, "Keep PrivateBit open until it finishes."],
  [/this computer/g, "this phone"],
  [/This computer/g, "This phone"],
];
const reword = (s: string): string => WORDING.reduce((a, [re, to]) => a.replace(re, to), s);

let secureOn = false;
function secureFor(route: string): void {
  const want = SECRET_ROUTES.has(route);
  if (want === secureOn || !isNative()) return;
  secureOn = want;
  void DeviceSecurity.setSecure({ on: want }).catch(() => undefined);
}

function applyBars(): void {
  if (!isNative()) return;
  const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark") || document.documentElement.dataset.theme === "dark" || (document.documentElement.dataset.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
}

// ---------- payment links from other apps (bitcoin: URIs) ----------
let pendingUri: string | null = null;
function takeUri(url: string | undefined): void {
  if (takeTxLink(url)) return;
  if (!url || !/^bitcoin:/i.test(url)) return;
  pendingUri = url;
  applyUri();
}
function applyUri(): void {
  if (!pendingUri || !S.b?.state.unlocked || S.dappId) return;
  if (["welcome", "seed", "verify", "import", "create-password", "import-password", "unlock", "boot", "starting"].includes(S.route)) return;
  const uri = pendingUri;
  pendingUri = null;
  go("send", {}, { reset: true });
  S.f.to = uri;
  // Audit L12 (independent): say where the request came from, so a link from another app is checked.
  S.f.fromLink = uri;
  render();
  toast("Payment request opened");
  toast("Payment request opened");
}

// ---------- extra controls on shared screens ----------
function wrap(route: string, f: (v: View) => View): void {
  const orig = screens[route];
  if (!orig) return;
  screens[route] = () => f(orig());
}
const prepend = (a: Safe, b: Safe | undefined): Safe => raw(a.s + (b?.s ?? ""));

function installScreens(): void {
  wrap("send", (v) => ({
    ...v,
    main: prepend(html`${S.f.fromLink && S.f.fromLink === S.f.to ? html`<div class="banner warn" role="alert" id="link-warn">${I("triangle-alert", "s16")}<div><span class="bt">Opened from a link in another app</span>Check the address and amount yourself. Apps and websites can fill in any address.</div></div>` : ""}<button class="btn btn-secondary btn-block scan-btn" type="button" data-act="qr-scan">${I("qr-code", "s16")}Scan a QR code</button>`, v.main),
  }));
}

actions["qr-scan"] = async () => {
  const text = await openScanner();
  if (!text) return;
  S.f.to = text.trim();
  render();
  toast("Code scanned");
};
// ---------- keyboard ----------
/** With the keyboard up the page is shorter: hide the bottom tabs and keep the field in view. */
function installKeyboard(): void {
  let tall = window.innerHeight;
  const editing = (): HTMLElement | null => {
    const a = document.activeElement as HTMLElement | null;
    return a && a.matches("input:not([type=checkbox]):not([type=radio]),textarea,select") ? a : null;
  };
  const update = (): void => {
    const h = window.innerHeight;
    const field = editing();
    if (!field || h > tall) tall = h;
    const open = !!field && h < tall * 0.8;
    document.body.classList.toggle("kb-open", open);
    if (open) field.scrollIntoView({ block: "center" });
  };
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => {
    tall = 0;
    setTimeout(update, 300);
  });
  document.addEventListener("focusin", () => setTimeout(update, 250));
  document.addEventListener("focusout", () => setTimeout(update, 250));
}

async function boot(): Promise<void> {
  const fromAgent = fontScaleFromAgent();
  applyFontScale(fromAgent ?? 1);
  installKeyboard();
  const tablet = Math.min(screen.width, screen.height) >= TABLET || window.innerWidth >= TABLET;
  const mode = tablet ? "full" : "popup";
  document.body.className = tablet ? "full-body mobile" : "popup-body mobile";
  document.documentElement.dataset.platform = "android";
  installScreens();
  installBio();
  installNotify();
  installBrowser();
  await start(mode);
  const base = mode === "full" ? fullHtml : popupHtml;
  setRenderer((v) => {
    secureFor(S.route);
    bioRoute(S.route);
    return reword(base(v));
  });
  render();
  applyBars();
  if (fromAgent === null && isNative()) {
    void DeviceSecurity.fontScale()
      .then((r) => {
        applyFontScale(r.scale);
        render();
      })
      .catch(() => undefined);
  }
  await ready;
  if (storeStatus() === "unreadable") toast("Saved wallet data on this phone could not be opened. Nothing was changed. Restore from your recovery words if this continues.");
  new MutationObserver(applyBars).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // Android back: close a sheet, then go back, then leave the app.
  void App.addListener("backButton", () => {
    if (document.querySelector(".pb-scanner")) {
      window.dispatchEvent(new Event("pb-scanner-close"));
      return;
    }
    if (S.sheet) {
      S.sheet = null;
      render();
      return;
    }
    if (S.route === "dapp") {
      window.close();
      return;
    }
    if (S.stack.length) back();
    else if (S.route !== "home" && S.b?.state.unlocked) go("home", {}, { reset: true });
    else void App.minimizeApp();
  });
  void App.addListener("appUrlOpen", (e) => takeUri(e.url));
  const launch = await App.getLaunchUrl().catch(() => undefined);
  takeUri(launch?.url);
  setInterval(() => {
    applyUri();
    applyTxLink();
  }, 700);
}

void boot();
