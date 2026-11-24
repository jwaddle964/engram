"""Draw the app icon (stacked cards + forgetting curve with review bumps)."""
import sys, math
from PIL import Image, ImageDraw, ImageFilter

def draw(size, maskable=False):
    S = size * 4  # supersample
    img = Image.new("RGB", (S, S), "#1d4ed8")
    d = ImageDraw.Draw(img)
    # vertical gradient background
    top, bot = (37, 99, 235), (30, 58, 138)
    for y in range(S):
        t = y / S
        d.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    pad = S * (0.22 if maskable else 0.15)
    w = S - 2 * pad
    ch = w * 0.74
    # back card
    back = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(back)
    x0, y0 = pad + w * 0.08, pad + (w - ch) / 2 - w * 0.08
    bd.rounded_rectangle([x0, y0, x0 + w * 0.92, y0 + ch], radius=S * 0.05, fill=(255, 255, 255, 110))
    back = back.rotate(8, resample=Image.BICUBIC, center=(S / 2, S / 2))
    img.paste(back, (0, 0), back)
    # front card with shadow
    fx0, fy0 = pad, pad + (w - ch) / 2 + w * 0.06
    fx1, fy1 = fx0 + w * 0.92, fy0 + ch
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([fx0 + S * 0.01, fy0 + S * 0.02, fx1 + S * 0.01, fy1 + S * 0.02], radius=S * 0.05, fill=(0, 0, 40, 90))
    sh = sh.filter(ImageFilter.GaussianBlur(S * 0.015))
    img.paste(sh, (0, 0), sh)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=S * 0.05, fill="#ffffff")
    # forgetting curve with review bumps inside the card
    cx0, cx1 = fx0 + w * 0.09, fx1 - w * 0.09
    cy0, cy1 = fy0 + ch * 0.2, fy1 - ch * 0.2
    segs = [(0.0, 0.3, 0.30), (0.3, 0.62, 0.52), (0.62, 1.0, 0.74)]
    pts = []
    for a, b, end in segs:
        k = -math.log(end)
        n = 200
        for i in range(n + 1):
            t = a + (b - a) * i / n
            local = (t - a) / (b - a)
            r = math.exp(-k * local)
            pts.append((cx0 + (cx1 - cx0) * t, cy1 - (cy1 - cy0) * r))
    # round brush along the polyline for a smooth thick stroke
    rad = S * 0.018
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dist = math.hypot(x2 - x1, y2 - y1)
        steps = max(1, int(dist / (rad * 0.3)))
        for j in range(steps + 1):
            x = x1 + (x2 - x1) * j / steps; y = y1 + (y2 - y1) * j / steps
            d.ellipse([x - rad, y - rad, x + rad, y + rad], fill="#2563eb")
    for a, _, _ in segs:
        x = cx0 + (cx1 - cx0) * a
        rr = S * 0.03
        d.ellipse([x - rr, cy0 - rr, x + rr, cy0 + rr], fill="#f59e0b")
    return img.resize((size, size), Image.LANCZOS)

out = sys.argv[1]
for s in (180, 192, 512):
    draw(s).save(f"{out}/icon-{s}.png")
draw(512, maskable=True).save(f"{out}/icon-maskable-512.png")
print("icons written")
