/**
 * Injected at document start into pages opened in PrivateBit's site browser (top frame only).
 * The bridge object is added by the app (WebMessageListener); the app learns the page's origin
 * from Android, never from this script. Then the same provider as the extension is defined.
 */
(() => {
  if (window.top !== window) return;
  const w = window as unknown as { privatebitBridge?: { postMessage: (s: string) => void; onmessage: ((e: { data: string }) => void) | null } };
  const B = w.privatebitBridge;
  if (!B) return;
  const ORIGIN = location.origin;
  window.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== window || e.origin !== ORIGIN) return;
    const d = e.data as { target?: string; id?: unknown; method?: unknown; params?: unknown } | null;
    if (!d || d.target !== "privatebit-cs" || typeof d.id !== "number") return;
    B.postMessage(JSON.stringify({ id: d.id, method: d.method, params: d.params }));
  });
  B.onmessage = (ev) => {
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return;
    }
    window.postMessage({ ...m, target: "privatebit-page" }, ORIGIN);
  };
  B.postMessage(JSON.stringify({ hello: true }));
})();
import "../shared/src/dapp/inpage.ts";
