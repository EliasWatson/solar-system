# Procedural Saturn ring texture (radial profile 74,500–140,220 km). Run: python3 scripts/make-ring.py
from PIL import Image
import math, random
W, rin, rout = 2048, 74500, 140220
random.seed(7)
im = Image.new('RGBA', (W, 4))
noise = [random.random() for _ in range(W)]
for x in range(W):
    r = rin + (rout - rin) * x / (W - 1)
    if r < 92000:   a, c = 0.10 + 0.12 * (r - rin) / 17500, (150, 135, 115)     # C ring
    elif r < 117580: a, c = 0.75 + 0.2 * math.sin((r - 92000) / 2500), (222, 205, 172)  # B ring
    elif r < 122170: a, c = 0.04, (90, 80, 70)                                  # Cassini division
    elif r < 136775: a, c = 0.55, (200, 185, 160)                               # A ring
    else: a, c = 0.12, (170, 160, 140)
    if 133400 < r < 133750: a = 0.02                                            # Encke gap
    if 136775 < r < 139000: a = 0.0
    if r > 139800: a = 0.25                                                      # F ring
    if r > 140100: a = 0
    a = max(0, min(1, a * (0.85 + 0.3 * noise[x])))
    col = tuple(int(v * (0.9 + 0.2 * noise[x])) for v in c) + (int(a * 255),)
    for y in range(4): im.putpixel((x, y), col)
im.save('public/textures/saturn_ring.png')
