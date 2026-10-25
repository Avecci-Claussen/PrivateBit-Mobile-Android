/**
 * Site browser: open a dApp inside PrivateBit. Android injects the same provider as the
 * extension, and each page message arrives with the origin Android reports. Requests go to the
 * same background handlers through a port, so per-site accounts, reviews and refusals are the
 * extension's own. Approvals show as a full screen over the site, then the site comes back.
 */
import { S, screens, actions, loaders, go, render, toast, type View } from "../shared/src/ui/app.ts";
import { call } from "../shared/src/ui/api.ts";
import { html, raw, I, type Safe } from "../shared/src/ui/kit.ts";
import { hdr } from "../shared/src/ui/chrome.ts";
import { DAPP_PORT } from "../shared/src/lib/dapp-proto.ts";
import { openPort, windowsOpen } from "./shim/install.ts";
import { DappBrowser, isNative } from "./shim/native.ts";
import type { SiteView } from "../shared/src/ui/screens/dapp.ts";

type Tab = { tab: string; origin: string; port?: ReturnType<typeof openPort> };
let current: Tab | null = null;
let returnTo: { route: string; params: Record<string, unknown> } | null = null;
let browserOpen = false;

function portFor(t: Tab): ReturnType<typeof openPort> {
  if (t.port) return t.port;
  t.port = openPort(
    DAPP_PORT,
    { id: chrome.runtime.id, url: `${t.origin}/`, origin: t.origin, tab: { id: 1 }, frameId: 0 },
    (m) => void DappBrowser.post({ tab: t.tab, message: JSON.stringify(m) }).catch(() => t.port?.close()),
  );
  return t.port;
}

function closeTab(): void {
  current?.port?.close();
  current = null;
}

function dark(): boolean {
  const t = document.documentElement.dataset.theme;
  return t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

export function normalizeUrl(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (!/^[a-z]+:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}

async function openSite(url: string): Promise<void> {
  if (!isNative()) {
    toast("The site browser runs in the Android app.");
    return;
  }
  closeTab();
  browserOpen = true;
  await DappBrowser.open({ url, dark: dark() });
}

function backFromApproval(): void {
  S.dappId = "";
  S.d.dappView = undefined;
  S.d.dappDone = undefined;
  const r = returnTo;
  returnTo = null;
  if (r) go(r.route, r.params, { reset: true });
  if (browserOpen) void DappBrowser.setVisible({ visible: true });
}

export function installBrowser(): void {
  // Approvals: the background "opens a window"; here it is a screen over the site.
  window.addEventListener("pb-window-open", (e) => {
    const { url } = (e as CustomEvent<{ id: number; url: string }>).detail;
    const m = /#dapp=([0-9a-f]{24})$/.exec(url);
    if (!m) return;
    if (!S.dappId) returnTo = { route: S.route === "dapp" ? "home" : S.route, params: S.params };
    S.dappId = m[1]!;
    S.d.dappView = undefined;
    S.d.dappDone = undefined;
    if (browserOpen) void DappBrowser.setVisible({ visible: false });
    go(S.b?.state.unlocked ? "dapp" : "unlock", {}, { reset: true });
  });
  window.addEventListener("pb-window-close", () => {
    if (S.dappId) backFromApproval();
  });
  // The shared approval screen calls window.close() when it is done or rejected.
  window.close = () => {
    if (!S.dappId) return;
    const want = `#dapp=${S.dappId}`;
    for (const [id, url] of windowsOpen) if (url.endsWith(want)) void chrome.windows.remove(id);
    if (S.dappId) backFromApproval();
  };
  if (isNative()) {
    void DappBrowser.addListener("message", (e) => {
      if (!current || current.tab !== e.tab || current.origin !== e.origin) {
        closeTab();
        current = { tab: e.tab, origin: e.origin };
      }
      let m: unknown;
      try {
        m = JSON.parse(e.message);
      } catch {
        return;
      }
      const p = portFor(current);
      if (m && typeof m === "object" && "hello" in (m as object)) return;
      p.fromPage(m);
    });
    void DappBrowser.addListener("pageStarted", () => closeTab());
    void DappBrowser.addListener("closed", () => {
      closeTab();
      browserOpen = false;
    });
  }

  loaders.browser = async () => {
    try {
      S.d.sites = await call<SiteView[]>({ type: "DAPP_SITES" });
    } catch {
      /* locked */
    }
    render();
  };
  screens.browser = (): View => {
    const sites = ((S.d.sites as SiteView[] | undefined) ?? []).filter((s) => s.connected);
    const err = S.err.burl;
    const list: Safe = sites.length
      ? html`<p class="label">Your connected sites</p><div class="list">${sites.map(
          (s) => html`<a class="li" href="#" data-act="browse-open" data-url="${s.origin}/"><span class="ico">${I("globe")}</span><span class="body"><span class="t">${new URL(s.origin).host}</span><span class="d">Opens with its own account</span></span>${I("chevron-right", "s16 chev")}</a>`,
        )}</div>`
      : html``;
    return {
      title: "Open a site",
      header: hdr({ title: "Open a site" }),
      main: html`<p class="small muted">Sites open inside PrivateBit. A site you connect gets its own account and never sees your receive code or private coins. Every signature or payment opens a review here first.</p>
  <div class="field" data-enter="browse-go"><label class="label" for="burl">Site address</label><input class="input" id="burl" data-f="burl" inputmode="url" autocapitalize="off" autocomplete="off" spellcheck="false" placeholder="app.example.com" value="${(S.f.burl as string | undefined) ?? ""}" ${err ? html`aria-invalid="true" aria-describedby="burl-e"` : ""}>${err ? html`<p class="err" id="burl-e" role="alert">${I("circle-alert", "s16")}<span>${err}</span></p>` : ""}</div>
  ${list}`,
      foot: html`<button class="btn btn-primary btn-block" type="button" data-act="browse-go">${I("globe", "s16")}Open</button>`,
    };
  };
  actions["browse-go"] = async () => {
    const url = normalizeUrl(String(S.f.burl ?? (document.getElementById("burl") as HTMLInputElement | null)?.value ?? ""));
    delete S.err.burl;
    if (!url) {
      S.err.burl = "Enter a web address, like app.example.com.";
      render();
      return;
    }
    await openSite(url);
  };
  actions["browse-open"] = async (el) => {
    const url = el.dataset.url;
    if (url) await openSite(url);
  };
  // Entry points: Settings list and Connected sites.
  const settings = screens.settings!;
  screens.settings = () => {
    const v = settings();
    const row = html`<a class="li" href="#" data-act="go" data-to="browser"><span class="ico">${I("globe")}</span><span class="body"><span class="t">Open a site</span><span class="d">Use dApps with a separate account per site</span></span>${I("chevron-right", "s16 chev")}</a>`;
    return { ...v, main: raw(v.main.s.replace('<div class="list">', `<div class="list">${row.s}`)) };
  };
  const sitesScreen = screens["set-sites"]!;
  screens["set-sites"] = () => ({ ...sitesScreen(), foot: html`<button class="btn btn-primary btn-block" type="button" data-act="go" data-to="browser">${I("globe", "s16")}Open a site</button>` });
}
