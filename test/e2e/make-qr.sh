#!/bin/sh
# Fake camera feed for the scanner test: a BIP21 QR code, as a short y4m clip (not committed).
set -e
python3 - <<'PY'
import qrcode
from PIL import Image
uri = "bitcoin:bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr?amount=0.00012"
q = qrcode.QRCode(border=4, box_size=8); q.add_data(uri); q.make()
img = q.make_image(fill_color="black", back_color="white").convert("RGB").resize((400, 400))
bg = Image.new("RGB", (640, 480), (200, 200, 200)); bg.paste(img, (120, 40)); bg.save("/tmp/qr.png")
PY
ffmpeg -loglevel error -y -loop 1 -i /tmp/qr.png -t 3 -r 10 -pix_fmt yuv420p /tmp/qr.y4m
