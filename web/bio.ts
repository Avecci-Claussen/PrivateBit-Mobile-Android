/**
 * Unlock with fingerprint or face. The wallet password is sealed by an Android Keystore key that
 * opens only after a strong biometric check (BIOMETRIC_STRONG) and is removed when fingerprints
 * or faces change. The password is still needed after a restart, after 5 tries that do not match,
 * after such a change, and always to show the recovery words.
 */
import { S, screens, actions, render, toast, run, type View } from "../shared/src/ui/app.ts";
import { call } from "../shared/src/ui/api.ts";
import { html, raw, I, type Safe } from "../shared/src/ui/kit.ts";
import { Biometric, hasDevice } from "./shim/native.ts";
import { bioAction, bioErrorText, bioNoun, bioUnavailableText, shouldAutoPrompt, type BioInfo } from "./bio-core.ts";

const OFFER_MS = 10 * 60_000;
const bio = {
  info: { available: false } as BioInfo,
  enabled: false,
  checkedFor: "",
  autoTried: false,
  notice: "",
  /** Turn it on again after an unlock with the password, because the sensor settings changed. */
  reEnroll: false,
  viaBio: false,
  offerPw: "",
  offerUntil: 0,
};

function walletId(): string {
  return S.b?.state.wallets?.find((w) => w.active)?.id ?? "default";
}
async function refreshBio(): Promise<void> {
  const id = walletId();
  bio.checkedFor = id;
  if (!hasDevice()) return;
  try {
    bio.info = await Biometric.available();
    bio.enabled = bio.info.available && (await Biometric.enabled({ id })).enabled;
  } catch {
    bio.info = { available: false, reason: "unsupported" };
    bio.enabled = false;
  }
}
const icon = (): Safe => I(bio.info.kind === "face" ? "scan-face" : "fingerprint", "s16");
const errCode = (e: unknown): string | undefined => (e as { code?: string }).code;

function wrap(route: string, f: (v: View) => View): void {
  const orig = screens[route];
  if (!orig) return;
  screens[route] = () => f(orig());
}
const prepend = (a: Safe, b: Safe | undefined): Safe => raw(a.s + (b?.s ?? ""));
const append = (a: Safe | undefined, b: Safe): Safe => raw((a?.s ?? "") + b.s);

function offerCard(): Safe {
  return html`<div class="card bio-offer" role="region" aria-label="${bioAction(bio.info.kind)}"><div class="row" data-st="4fb60c"><span class="ico">${I(bio.info.kind === "face" ? "scan-face" : "fingerprint")}</span><span class="grow stack" data-st="d76768"><span class="strong">${bioAction(bio.info.kind)}?</span><span class="small muted">Faster than typing your password. Your password stays the way back in, and is still needed after a restart and to show your recovery words.</span></span></div>
    <div class="row" data-st="4725bb"><button class="btn btn-primary grow" type="button" data-act="bio-offer-on">${icon()}Turn on</button><button class="btn btn-secondary grow" type="button" data-act="bio-offer-skip">Not now</button></div></div>`;
}
const offering = (): boolean => !!bio.offerPw && Date.now() < bio.offerUntil && bio.info.available && !bio.enabled;

let lastRoute = "";
/** Called on every render. */
export function bioRoute(route: string): void {
  if (route !== lastRoute) {
    lastRoute = route;
    if (["unlock", "set-security", "ready", "home"].includes(route) && hasDevice()) void refreshBio().then(render);
  }
  if (route !== "unlock" && S.b?.state.unlocked) bio.autoTried = false;
  if (bio.offerPw && (!S.b?.state.unlocked || Date.now() >= bio.offerUntil || (route !== "ready" && route !== "home"))) bio.offerPw = "";
}

export function installBio(): void {
  wrap("unlock", (v) => {
    if (!hasDevice()) return v;
    if (bio.checkedFor !== walletId()) void refreshBio().then(render);
    const notice = bio.notice ? html`<div class="banner bio-note" role="status">${I("info", "s16")}<div>${bio.notice}</div></div>` : raw("");
    if (!bio.enabled || S.busy === "unlock") return bio.notice ? { ...v, main: prepend(notice, v.main) } : v;
    if (shouldAutoPrompt({ enabled: bio.enabled, visible: document.visibilityState === "visible", alreadyTried: bio.autoTried, busy: S.busy === "unlock" })) {
      bio.autoTried = true;
      setTimeout(() => void actions["bio-unlock"]!(document.body, new Event("auto")), 250);
    }
    const foot = v.foot && "cls" in v.foot ? v.foot : { cls: "plain", html: (v.foot as Safe | undefined) ?? raw("") };
    return { ...v, main: prepend(notice, v.main), foot: { cls: foot.cls, html: prepend(html`<button class="btn btn-secondary btn-block" type="button" data-act="bio-unlock">${icon()}${bioAction(bio.info.kind)}</button>`, foot.html) } };
  });

  wrap("set-security", (v) => {
    if (!hasDevice()) return v;
    if (bio.checkedFor !== walletId()) void refreshBio().then(render);
    const noun = bioNoun(bio.info.kind);
    const title = bioAction(bio.info.kind);
    let box: Safe;
    const why = bioUnavailableText(bio.info);
    if (why) box = html`<div class="card"><div class="row" data-st="4fb60c"><span class="ico">${I("fingerprint")}</span><span class="grow stack" data-st="d76768"><span class="strong">Unlock with fingerprint or face</span><span class="small muted">${why}</span></span></div></div>`;
    else if (bio.enabled)
      box = html`<div class="card"><div class="row" data-st="4fb60c"><span class="ico ok">${icon()}</span><span class="grow stack" data-st="d76768"><span class="strong">${title} is on</span><span class="small muted">Your password is sealed by a key in this phone's secure hardware that opens only with your ${noun}. Your password is still needed after the phone restarts, after 5 tries that do not match, if ${noun} settings change, and to show your recovery words.</span></span></div>
        <button class="btn btn-secondary btn-block" type="button" data-act="bio-off">Turn off</button></div>`;
    else
      box = html`<div class="card"><div class="row" data-st="4fb60c"><span class="ico">${icon()}</span><span class="grow stack" data-st="d76768"><span class="strong">${title}</span><span class="small muted">Optional. Enter your password once to turn it on. It is then sealed by this phone's secure hardware and opens with your ${noun}.</span></span></div>
          ${bio.reEnroll ? html`<p class="small muted" role="status">${I("info", "s16")} The ${noun} settings on this phone changed, so this was turned off. Turn it on again if you like.</p>` : ""}
          <div class="field"><label class="label" for="biopw">Password</label><input class="input" id="biopw" data-f="biopw" type="password" autocomplete="current-password" value="" ${S.err.bio ? html`aria-invalid="true" aria-describedby="biopw-e"` : ""}>${S.err.bio ? html`<p class="err" id="biopw-e" role="alert">${I("circle-alert", "s16")}<span>${S.err.bio}</span></p>` : ""}</div>
          <button class="btn btn-primary btn-block" type="button" data-act="bio-on">${icon()}Turn on</button></div>`;
    const block = html`<h2 class="sec-h"><span>Unlock</span></h2>${box}`;
    const m = v.main?.s ?? "";
    const at = m.indexOf('<div class="card" data-st="65a660">');
    return { ...v, main: at < 0 ? append(v.main, block) : raw(m.slice(0, at) + block.s + m.slice(at)) };
  });

  wrap("ready", (v) => (offering() ? { ...v, main: append(v.main, offerCard()) } : v));
  wrap("home", (v) => (offering() ? { ...v, main: prepend(offerCard(), v.main) } : v));

  const keepOffer = (name: string): void => {
    const orig = actions[name];
    if (!orig) return;
    actions[name] = async (el, ev) => {
      const pw = String(S.f.pw ?? "");
      await orig(el, ev);
      if (!S.b?.state.unlocked || !pw || !hasDevice()) return;
      await refreshBio();
      if (bio.info.available && !bio.enabled) {
        bio.offerPw = pw;
        bio.offerUntil = Date.now() + OFFER_MS;
        render();
      }
    };
  };
  keepOffer("finish-create");
  keepOffer("import-finish");

  // A new password makes the sealed copy useless: turn the sensor unlock off and say so.
  const pwChange = actions["pw-change"];
  if (pwChange) {
    actions["pw-change"] = async (el, ev) => {
      await pwChange(el, ev);
      if (S.err.cpw || !hasDevice() || !bio.enabled) return;
      await Biometric.disable({ id: walletId() }).catch(() => undefined);
      await refreshBio();
      toast(`Password changed. Turn on ${bioNoun(bio.info.kind)} unlock again in Security if you like.`);
    };
  }

  const unlock = actions.unlock!;
  actions.unlock = async (el, ev) => {
    const viaBio = bio.viaBio;
    await unlock(el, ev);
    if (!S.b?.state.unlocked || !hasDevice()) return;
    bio.notice = "";
    if (!viaBio) await Biometric.passwordUsed().catch(() => undefined);
    if (bio.reEnroll && !viaBio) {
      await refreshBio();
      if (bio.info.available && !bio.enabled) toast(`${bioAction(bio.info.kind)} was turned off because the phone's settings changed. Turn it on again in Settings > Security.`);
    }
  };
}

actions["bio-on"] = async () => {
  const pw = (document.getElementById("biopw") as HTMLInputElement | null)?.value ?? "";
  delete S.err.bio;
  if (!pw) {
    S.err.bio = "Enter your password.";
    render();
    return;
  }
  const ok = await run(
    "bio",
    async () => {
      await call({ type: "CHECK_WALLET_PASSWORD", id: walletId(), password: pw });
      try {
        await Biometric.enable({ id: walletId(), secret: pw, title: `Turn on ${bioNoun(bio.info.kind)} unlock`, subtitle: `Confirm with your ${bioNoun(bio.info.kind)}`, cancel: "Cancel" });
      } catch (e) {
        if (errCode(e) === "cancelled") return false;
        throw e;
      }
      return true;
    },
    "bio",
  );
  if (ok) {
    bio.reEnroll = false;
    await refreshBio();
    toast(`${bioAction(bio.info.kind)} is on`);
  }
  render();
};
actions["bio-off"] = async () => {
  await Biometric.disable({ id: walletId() }).catch(() => undefined);
  await refreshBio();
  toast(`${bioAction(bio.info.kind)} is off`);
  render();
};
actions["bio-offer-on"] = async () => {
  const pw = bio.offerPw;
  bio.offerPw = "";
  if (!pw) return;
  try {
    await Biometric.enable({ id: walletId(), secret: pw, title: `Turn on ${bioNoun(bio.info.kind)} unlock`, subtitle: `Confirm with your ${bioNoun(bio.info.kind)}`, cancel: "Cancel" });
    await refreshBio();
    toast(`${bioAction(bio.info.kind)} is on`);
  } catch (e) {
    if (errCode(e) !== "cancelled") toast("It could not be turned on. You can try again in Settings > Security.");
  }
  render();
};
actions["bio-offer-skip"] = () => {
  bio.offerPw = "";
  toast("You can turn it on later in Settings > Security.");
  render();
};
actions["bio-unlock"] = async () => {
  if (S.busy === "unlock") return;
  bio.notice = "";
  try {
    const { secret } = await Biometric.unlock({ id: walletId(), title: "Unlock PrivateBit", subtitle: `Use your ${bioNoun(bio.info.kind)}`, cancel: "Use password" });
    const input = document.getElementById("pw") as HTMLInputElement | null;
    S.f.pw = secret;
    if (input) input.value = secret;
    bio.viaBio = true;
    try {
      await actions.unlock!(document.body, new Event("click"));
    } finally {
      bio.viaBio = false;
      delete S.f.pw;
    }
    if (!S.b?.state.unlocked) {
      // The saved password no longer opens this wallet (it was changed elsewhere): start over.
      await Biometric.disable({ id: walletId() }).catch(() => undefined);
      await refreshBio();
      S.err = {};
      bio.notice = "Your password changed, so fingerprint or face unlock was turned off. Unlock with your password.";
      render();
    }
  } catch (e) {
    const code = errCode(e);
    if (code === "changed") {
      bio.reEnroll = true;
      await refreshBio();
    }
    bio.notice = bioErrorText(code, bio.info.kind) ?? "";
    render();
    if (code === "cancelled") (document.getElementById("pw") as HTMLInputElement | null)?.focus();
  }
};

