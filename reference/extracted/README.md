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
