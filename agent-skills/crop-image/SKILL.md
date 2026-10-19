---
name: crop-image
description: Coordinate systems, centring and validation rules for crop_image.
---
# Cropping images with crop_image

`crop_image` takes a public HTTPS `image_url` and **exactly one** rectangle form:

| Form | Fields | Units |
|---|---|---|
| Percent | `x_percent`, `y_percent`, `width_percent`, `height_percent` (defaults 0, 0, 100, 100) | 0–100 of the image size |
| Pixels | `width_px`, `height_px` (required), `x_px`, `y_px` (optional) | pixels; without `x_px`/`y_px` the crop is centred |

## Rules
- The origin (0, 0) is the **top-left** corner; x grows right, y grows down.
- The rectangle must lie fully inside the image: `x + width ≤ 100` (percent) or the image width (pixels),
  and the same for y.
- Never mix forms in one call.

## Common requests
- "Center square crop": pixel form with only `width_px` and `height_px`, both equal to the shorter side.
- "Left half": percent form `x 0, y 0, width 50, height 100`.
- "Remove 10% border": percent form `x 10, y 10, width 80, height 80`.

If the user's request is ambiguous ("crop to the face"), ask once or choose a sensible centred crop and
say what you did.
