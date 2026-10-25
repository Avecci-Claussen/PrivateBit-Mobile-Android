#!/usr/bin/env python3
"""Contact sheets for /workspace/wallet/v2/screens/apk (web phone viewport run and emulator run)."""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = "/workspace/wallet/v2/screens/apk"
def font(n):
    for f in ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(f): return ImageFont.truetype(f, n)
    return ImageFont.load_default()
def sheet(files, out, title, w=300, cols=6):
    files = [f for f in files if os.path.exists(f)]
    if not files: return
    ims = [Image.open(f).convert("RGB") for f in files]
    cells = []
    for im in ims:
        h = int(w * im.height / im.width)
        cells.append(im.resize((w, h), Image.LANCZOS))
    ch = max(c.height for c in cells) + 34
    rows = (len(cells) + cols - 1) // cols
    S = Image.new("RGB", (cols * (w + 16) + 16, rows * (ch + 16) + 70), (24, 20, 40))
    d = ImageDraw.Draw(S)
    d.text((16, 20), title, fill=(244, 241, 234), font=font(26))
    for i, (c, f) in enumerate(zip(cells, files)):
        x = 16 + (i % cols) * (w + 16); y = 70 + (i // cols) * (ch + 16)
        S.paste(c, (x, y))
        d.text((x, y + c.height + 6), os.path.basename(f)[:-4], fill=(200, 196, 220), font=font(14))
    S.save(out)
    print(out, len(files))
web = os.path.join(ROOT, "web")
names = lambda pat: [os.path.join(web, f"{p}.png") for p in pat]
flow = ["welcome-dark-412x915", "create-dark-412x915", "ready-dark-412x915", "home-dark-412x915", "receive-dark-412x915", "pay-from-dark-412x915",
        "review-dark-412x915", "confirm-sheet-dark-412x915", "payjoin-dark-412x915", "settings-dark-412x915", "security-dark-412x915", "open-site-dark-412x915",
        "appearance-dark-412x915", "unlock-dark-412x915", "home-bitcoin-dark-412x915", "receive-bitcoin-dark-412x915"]
sheet(names(flow), os.path.join(ROOT, "contact-sheet-flow.png"), "PrivateBit Android: main flow, 412x915 dark (phone viewport run)")
sizes = []
for scr in ["home", "receive", "review", "settings", "unlock"]:
    for t in ["dark", "light"]:
        for s in ["360x800", "412x915", "tablet-800x1280"]:
            sizes.append(f"{scr}-{t}-{s}")
sheet(names(sizes), os.path.join(ROOT, "contact-sheet-sizes.png"), "PrivateBit Android: 360x800, 412x915, tablet 800x1280, dark and light", w=220, cols=6)
dev = os.path.join(ROOT, "device")
if os.path.isdir(dev):
    sheet(sorted(os.path.join(dev, f) for f in os.listdir(dev) if f.endswith(".png")), os.path.join(ROOT, "contact-sheet-emulator.png"), "PrivateBit Android: emulator (Android 15, debug-e2e APK)", w=260, cols=6)
