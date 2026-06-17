import os
from collections import deque
from PIL import Image, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "icon-candidates")
SRC = os.path.join(OUT, "02-helmet-screen.png")
WORK = 512          # mask compute resolution (speed)
THRESH = 10         # plateau: fill stops at helmet edge without eating the body
PAD_FRAC = 0.06     # margin around helmet on the final square canvas

def build_mask(rgb, thresh):
    """Region-grow the background inward from all border pixels using a local gradient
    threshold. Returns an 'L' image: 0 = background, 255 = foreground (helmet)."""
    w, h = rgb.size
    px = rgb.load()
    bg = bytearray(w * h)            # 0 = unknown/foreground, 1 = background
    q = deque()
    def consider(x, y, ref):
        i = y * w + x
        if bg[i]:
            return
        r, g, b = px[x, y][:3]
        rr, rg, rb = ref
        if abs(r - rr) + abs(g - rg) + abs(b - rb) <= thresh:
            bg[i] = 1
            q.append((x, y, (r, g, b)))
    # seed every border pixel against itself
    for x in range(w):
        consider(x, 0, px[x, 0][:3])
        consider(x, h - 1, px[x, h - 1][:3])
    for y in range(h):
        consider(0, y, px[0, y][:3])
        consider(w - 1, y, px[w - 1, y][:3])
    while q:
        x, y, ref = q.popleft()
        if x > 0: consider(x - 1, y, ref)
        if x < w - 1: consider(x + 1, y, ref)
        if y > 0: consider(x, y - 1, ref)
        if y < h - 1: consider(x, y + 1, ref)
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        row = y * w
        for x in range(w):
            mp[x, y] = 0 if bg[row + x] else 255
    return mask

def keep_largest(mask):
    """Zero every foreground component except the largest blob (the helmet) so stray
    border/corner specks from the source's rounded-rect frame are dropped."""
    w, h = mask.size
    mp = mask.load()
    seen = bytearray(w * h)
    best = []
    for sy in range(h):
        for sx in range(w):
            i = sy * w + sx
            if seen[i] or mp[sx, sy] < 128:
                continue
            comp = []
            q = deque([(sx, sy)])
            seen[i] = 1
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and mp[nx, ny] >= 128:
                            seen[j] = 1
                            q.append((nx, ny))
            if len(comp) > len(best):
                best = comp
    out = Image.new("L", (w, h), 0)
    op = out.load()
    for x, y in best:
        op[x, y] = 255
    return out

def main():
    src = Image.open(SRC).convert("RGB")
    small = src.resize((WORK, WORK), Image.LANCZOS)
    mask_s = build_mask(small, THRESH)
    mask_s = keep_largest(mask_s)
    # clean: fill tiny holes by majority blur, erode 1px to kill dark edge fringe, feather
    mask_s = mask_s.filter(ImageFilter.MedianFilter(3))
    mask = mask_s.resize(src.size, Image.LANCZOS)
    mask = mask.filter(ImageFilter.MinFilter(3))        # erode -> shrink off the dark rim
    mask = mask.filter(ImageFilter.GaussianBlur(0.8))   # feather edge
    cov = sum(mask.histogram()[128:]) / (src.size[0] * src.size[1])
    print(f"foreground coverage: {cov:.1%}")
    helmet = src.convert("RGBA")
    helmet.putalpha(mask)
    bbox = mask.getbbox()
    print("helmet bbox:", bbox, "of", src.size)
    helmet = helmet.crop(bbox)
    # center on padded square transparent canvas (helmet bigger -> fills frame)
    w, h = helmet.size
    side = max(w, h)
    pad = int(side * PAD_FRAC)
    canvas = side + 2 * pad
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    out.paste(helmet, ((canvas - w) // 2, (canvas - h) // 2), helmet)
    preview = out.resize((512, 512), Image.LANCZOS)
    preview.save(os.path.join(OUT, "02-helmet-final.png"))
    # final app icon: transparent multi-res .ico + a 512 png master
    preview.save(os.path.join("build", "icon.png"))
    sizes = [256, 128, 64, 48, 32, 16]
    imgs = [out.resize((n, n), Image.LANCZOS) for n in sizes]
    imgs[0].save(os.path.join("build", "icon.ico"), format="ICO",
                 sizes=[(n, n) for n in sizes], append_images=imgs[1:])
    print("wrote design/icon-candidates/02-helmet-final.png + build/icon.{png,ico}", preview.size)
    return out

if __name__ == "__main__":
    main()
