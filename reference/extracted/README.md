# Extracted woodland trees (woodland-forest-rustic-trees.png)

Vector traces of the two tree decorations, shipped to `/assets/`. Script:
`extract_trees.py`.

**Not currently applied** — the pages kept the hand-drawn `#branchart` fronds by
preference. To switch, point `.branch.tr` / `.branch.bl` at
`assets/branch-tr.svg` / `assets/tree-left.svg` as `<img>` (they read best flush
to the corners at ~30vw/24vw, behind the content, with the trunk bleeding off the
page edge).

This print is NOT flat-ink — leaves shade continuously from dark outline through
rust and orange to pale peach — so it is posterized with a 6-class ramp
(#3a1800, #704823→#804b14 rust, #ac773b orange, #cd9c6b tan/trunk, #f6c693 peach)
instead of per-ink quantization. Method beyond the base skill pipeline:

- text/card-edge rect masks + **adaptive frame-line masks** (the inner frame runs
  through the foliage; the line is erased only where art doesn't span it, so
  stems crossing the frame survive);
- 4x labeling by **pair-unmixing** (nearest ink-pair segment, assign dominant
  endpoint) with a 3x3 source-neighborhood class constraint — plain
  nearest-centroid mislabels cubic-blend pixels (gold+cream lands on peach,
  cream+dark lands on tan);
- clean colors = median of the most-chromatic half per class (edge blends
  otherwise gray the medians);
- eps 0.8 / min-area 16 at 4x (features here are 1-4 source px).

| asset | source crop (x,y,w,h) | RMSE vs masked photo | posterize floor | size |
|---|---|---|---|---|
| tree-left.svg | 0,140,185,267 | 21.2 | 10.3 | 88 kB |
| branch-tr.svg | 110,0,182,150 | 25.5 | 11.1 | 75 kB |

The gap above the floor is boundary antialiasing at 1-4px feature scale plus
ramp posterization; interior class agreement vs the source labeling is exact.
`*-compare2x.png` show photo vs render at display scale.

# Extracted thistle patterns (art-nouveau-thistle.png)

Vector traces of the original border artwork. Method: 4x cubic upscale,
3-color nearest-palette quantization (cream #e4e1d4 / blue #6a8d9e / olive #bab691),
OpenCV contour trace (RETR_CCOMP, approxPolyDP eps=1.6 at 4x = 0.4px),
transparent background (page supplies cream). viewBox is 4x source pixels.

RMSE = root mean square error (0-255 RGB) of the SVG rendered back at source
size vs the original photo crop. Quantization floor is ~12-14 (paper texture,
soft print edges) - i.e. these traces are near the best any flat-color vector can do.

| asset | source crop (x,y,w,h) | RMSE vs photo | size |
|---|---|---|---|
| corner-tl.svg | 0,0,210,210 | 14.8 | 28.4 kB |
| edge-left.svg | 0,205,115,243 | 16.4 | 23.4 kB |
| edge-top.svg | 116,0,164,110 | 18.4 | 18.1 kB |

- corner-tl: top-left corner composition (card text + off-card sliver masked to cream before tracing).
- edge-left: one ~243px vertical repeat of the side border (period found by autocorrelation; tiling seam is visible but acceptable).
- edge-top: one ~164px horizontal repeat of the top border.
- Other corners/edges in the original are mirrors of these.
