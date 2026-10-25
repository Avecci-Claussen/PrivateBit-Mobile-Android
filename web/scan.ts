/**
 * QR scanner for the Send screen. The camera is asked for only when you tap Scan, and it stops
 * as soon as a code is read or you close the scanner. Frames are decoded on this phone (jsQR);
 * no image leaves the app.
 */
import jsQR from "jsqr";

export function openScanner(): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "pb-scanner";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Scan a QR code");
    wrap.innerHTML = `<video playsinline muted aria-hidden="true"></video><div class="pb-scan-frame" aria-hidden="true"></div>
      <div class="pb-scan-bar"><p class="pb-scan-msg" role="status">Point the camera at a payment QR code</p>
      <button class="btn btn-secondary btn-block" type="button" data-scan-close>Cancel</button></div>`;
    document.body.append(wrap);
    const video = wrap.querySelector("video")!;
    const msg = wrap.querySelector(".pb-scan-msg")!;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    let stream: MediaStream | null = null;
    let done = false;
    const finish = (v: string | null): void => {
      if (done) return;
      done = true;
      stream?.getTracks().forEach((t) => t.stop());
      wrap.remove();
      window.removeEventListener("pb-scanner-close", close);
      resolve(v);
    };
    const close = (): void => finish(null);
    window.addEventListener("pb-scanner-close", close);
    wrap.querySelector("[data-scan-close]")!.addEventListener("click", close);
    const tick = (): void => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = 640;
        const h = Math.round((video.videoHeight / video.videoWidth) * w);
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);
        const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
        if (code?.data) return finish(code.data);
      }
      requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        stream = s;
        if (done) return s.getTracks().forEach((t) => t.stop());
        video.srcObject = s;
        void video.play();
        requestAnimationFrame(tick);
      })
      .catch(() => {
        msg.textContent = "PrivateBit needs the camera to scan. Allow it in Android settings, or paste the code instead.";
      });
  });
}
