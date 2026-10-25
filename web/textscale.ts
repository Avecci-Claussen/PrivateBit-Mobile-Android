/**
 * Text size. The phone's font size setting drives the page's type scale (--fs in tokens.css):
 * text, line heights and text boxes grow together. WebView text zoom is off (MainActivity), so
 * letters never outgrow their boxes. data-fs="lg" lets narrow layouts drop chip labels earlier.
 */
/** Largest text scale the layout is built for (matches MainActivity.MAX_FONT_SCALE). */
export const MAX_FONT_SCALE = 1.3;

export function applyFontScale(scale: number, root: HTMLElement = document.documentElement): number {
  const s = Math.max(0.85, Math.min(MAX_FONT_SCALE, Number.isFinite(scale) && scale > 0 ? scale : 1));
  root.style.setProperty("--fs", s.toFixed(2));
  root.dataset.fs = s >= 1.15 ? "lg" : "md";
  return s;
}

/** MainActivity appends "PBFontScale/1.30" to the WebView user agent before the page loads. */
export function fontScaleFromAgent(ua: string = navigator.userAgent): number | null {
  const m = ua.match(/PBFontScale\/([\d.]+)/);
  return m ? Number(m[1]) : null;
}
