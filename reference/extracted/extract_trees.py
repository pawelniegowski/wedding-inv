#!/usr/bin/env python3
"""Trace the woodland 'trees' decorations (left tree + top-right branch)
into transparent SVGs, per the svg-pattern-extract skill."""
import numpy as np, cv2, io, sys
from PIL import Image

SRC = '/home/rsh/wedding-inv/reference/woodland-forest-rustic-trees.png'
img = cv2.imread(SRC)[:, :, ::-1].copy()
H, W = img.shape[:2]

# The print shades leaves along a ramp, not flat inks — posterize with 6 classes:
# 0 bg creams, 1 dark outline, 2 rust, 3 orange, 4 light tan (leaf light + trunk
# mauve share this tone), 5 peach highlight
CENTS = np.array([
    [226, 217, 202], [236, 228, 216], [254, 246, 229],  # creams -> 0
    [51, 19, 5], [78, 31, 6],                           # darks  -> 1
    [97, 54, 23], [125, 77, 33],                        # rust   -> 2
    [165, 117, 69],                                     # orange -> 3
    [195, 155, 116],                                    # tan    -> 4
    [238, 197, 153],                                    # peach  -> 5
], float)
C2CLASS = np.array([0, 0, 0, 1, 1, 2, 2, 3, 4, 5])
NCLS = 6

CREAM = (236, 228, 216)

def classify(a):
    return C2CLASS[((a[:, :, None, :].astype(float) - CENTS[None, None]) ** 2)
                   .sum(3).argmin(2)]

# ---- rect masks: card edges, text, frame interior (full-image coords) ----
RECTS = [
    (0, 0, 8, H),            # card left edge
    (0, 399, W, H),          # card bottom edge
    (0, 0, W, 7),            # card top edge
    (286, 0, W, H),          # card right edge
    # left tree area
    (58, 140, 185, 182),     # script names text (upper)
    (68, 182, 185, 195),     # script names text (lower, spares leaf tips)
    (86, 195, 185, 336),     # inside frame: SATURDAY/date block
    # top-right branch area
    (110, 75, 188, 121),     # SAVE THE DATE text (stem curl tip lives at x>=189)
    (110, 112, 235, 151),    # Williams script
    (183, 90, 191, 103),     # stray text specks left of the curl tip
]
masked = img.copy()
for x0, y0, x1, y1 in RECTS:
    masked[y0:y1, x0:x1] = CREAM
# rounded card corner top-right: outside the corner radius -> cream
for y in range(0, 24):
    dx2 = 23 ** 2 - (y - 24) ** 2
    cut = 269 + int(dx2 ** .5) if dx2 > 0 else 269
    masked[y, cut:] = CREAM

# ---- adaptive frame-line masks: erase line wherever art doesn't span it
# (a genuine crossing has ink on BOTH sides; else the line is exposed) ----
def v_line(x0, x1, y0, y1, pad=6):
    cls0 = classify(masked)
    for y in range(y0, y1):
        left = cls0[y, max(0, x0 - pad):x0]
        right = cls0[y, x1:x1 + pad]
        if (left == 0).all() or (right == 0).all():
            masked[y, x0:x1] = CREAM
def h_line(y0, y1, x0, x1, pad=6):
    cls0 = classify(masked)
    for x in range(x0, x1):
        up = cls0[max(0, y0 - pad):y0, x]
        dn = cls0[y1:y1 + pad, x]
        if (up == 0).all() or (dn == 0).all():
            masked[y0:y1, x] = CREAM
for _ in range(2):  # second pass cleans corner stubs the first pass exposes
    v_line(49, 59, 140, 340)     # frame left vertical
    h_line(339, 348, 49, 260)    # frame bottom horizontal
    h_line(65, 76, 110, 240)     # frame top horizontal
    v_line(230, 241, 65, 151)    # frame right vertical

# ---- clean ink colors via erode-median (exclude blend cluster from darks) ----
lab10 = ((masked[:, :, None, :].astype(float) - CENTS[None, None]) ** 2).sum(3).argmin(2)
CLEAN = {}
for k, clusters in {1: (3, 4), 2: (5, 6), 3: (7,), 4: (8,), 5: (9,)}.items():
    m = (np.isin(lab10, clusters) * 255).astype(np.uint8)
    er = cv2.erode(m, np.ones((3, 3), np.uint8))
    sel = er if er.sum() > 255 * 50 else m
    px = img[sel > 0].astype(float)
    # thin inks leave no interior after erosion; edge blends gray the median.
    # keep the most chromatic half — ink cores — before taking the median
    chroma = px.max(1) - px.min(1)
    if k > 1:
        px = px[chroma >= np.percentile(chroma, 55)]
    CLEAN[k] = tuple(int(v) for v in np.median(px, axis=0))
print('clean ink colors:', {k: '#%02x%02x%02x' % v for k, v in CLEAN.items()})

CROPS = {'tree-left': (0, 140, 185, 407), 'branch-tr': (110, 0, 292, 150)}
SCALE = 4
DRAW_ORDER = [5, 4, 3, 2, 1]  # light to dark; dark last keeps outlines crisp

def classify_constrained(big, lab1):
    """Nearest-centroid at 4x with two guards:
    1. blend centroids — cubic upscaling creates mixture pixels along every
       ink-pair segment (gold+cream lands near PEACH); adding t=0.25/0.5/0.75
       points per pair, each owned by its dominant endpoint, partitions
       mixtures between their true endpoints instead of a third class;
    2. neighborhood constraint — a class may only win where it exists in the
       source pixel's 3x3 neighborhood at 1x."""
    h4, w4 = big.shape[:2]
    ncls = NCLS
    base = np.array([CREAM] + [CLEAN[k] for k in range(1, NCLS)], float)
    p = big.astype(float)
    allowed = np.zeros((h4, w4, ncls), bool)
    kern = np.ones((3, 3), np.uint8)
    for k in range(ncls):
        pres = cv2.dilate(((lab1 == k) * 255).astype(np.uint8), kern)
        allowed[:, :, k] = cv2.resize(pres, (w4, h4),
                                      interpolation=cv2.INTER_NEAREST) > 0
    best = np.full((h4, w4), np.inf)
    lab = np.zeros((h4, w4), np.int64)
    for a in range(ncls):
        for b in range(a, ncls):
            ok = allowed[:, :, a] & allowed[:, :, b]
            if not ok.any():
                continue
            ca, cb = base[a], base[b]
            if a == b:
                resid = ((p - ca) ** 2).sum(2)
                cls_ab = np.full((h4, w4), a)
            else:
                e = cb - ca
                t = np.clip(((p - ca) @ e) / (e @ e), 0, 1)
                resid = ((p - (ca + t[:, :, None] * e)) ** 2).sum(2)
                cls_ab = np.where(t < .5, a, b)
            resid = np.where(ok, resid, np.inf)
            upd = resid < best
            best[upd] = resid[upd]
            lab[upd] = cls_ab[upd]
    return lab

def trace(name, eps=0.8):
    x0, y0, x1, y1 = CROPS[name]
    crop = masked[y0:y1, x0:x1]
    h, w = crop.shape[:2]
    big = cv2.resize(crop, (w * SCALE, h * SCALE), interpolation=cv2.INTER_CUBIC)
    lab = classify_constrained(big, classify(crop))
    paths = []
    for k in DRAW_ORDER:
        m = ((lab == k) * 255).astype(np.uint8)
        cnts, _ = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
        d = ['M' + ' '.join(f'{x},{y}' for x, y in
             cv2.approxPolyDP(c, eps, True).reshape(-1, 2)) + 'Z'
             for c in cnts if cv2.contourArea(c) >= 16]
        if d:
            paths.append('<path d="%s" fill="#%02x%02x%02x" fill-rule="evenodd"/>'
                         % (' '.join(d), *CLEAN[k]))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w*SCALE} {h*SCALE}">'
           + ''.join(paths) + '</svg>')
    open(f'{name}.svg', 'w').write(svg)
    flat = np.zeros_like(crop); flat[:] = CREAM
    lab1 = classify(crop)
    for k in range(1, NCLS):
        flat[lab1 == k] = CLEAN[k]
    cv2.imwrite(f'{name}-flat.png', cv2.resize(flat[:, :, ::-1], None, fx=3, fy=3,
                interpolation=cv2.INTER_NEAREST))
    return svg, crop, flat

def verify(svg, crop, flat, name):
    import cairosvg
    h, w = crop.shape[:2]
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=w, output_height=h,
                           background_color='#%02x%02x%02x' % CREAM)
    rend = np.asarray(Image.open(io.BytesIO(png)).convert('RGB'), float)
    # reference = the MASKED photo (text/frame/card-edge removal is intentional)
    src = crop.astype(float)
    rmse = lambda a, b: float(np.sqrt(((a - b) ** 2).mean()))
    side = np.hstack([src, np.full((h, 6, 3), 128.0), rend])
    Image.fromarray(side.astype(np.uint8)).resize((side.shape[1] * 2, h * 2),
                                                  Image.NEAREST).save(f'{name}-compare.png')
    print(f'{name}: RMSE(render,maskedphoto)={rmse(rend, src):.1f}  '
          f'floor(flat,maskedphoto)={rmse(flat.astype(float), src):.1f}')

for name in CROPS:
    svg, crop, flat = trace(name)
    if '--verify' in sys.argv:
        verify(svg, crop, flat, name)
print('done')
