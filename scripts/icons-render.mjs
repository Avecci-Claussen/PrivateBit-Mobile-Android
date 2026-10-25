import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const jobs = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome` });
const p = await b.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  await p.setViewportSize({ width: j.w, height: j.h });
  await p.setContent(`<html><body style="margin:0;background:transparent">${j.svg}</body></html>`);
  await p.screenshot({ path: j.out, omitBackground: true });
}
await b.close();
