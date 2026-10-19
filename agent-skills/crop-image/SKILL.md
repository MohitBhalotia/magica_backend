---
name: crop-image
description: Coordinate systems, centring and validation rules for crop_image.
---
# Cropping images with crop_image

`crop_image` takes an `image_url` and **exactly one** rectangle form:

| Form | Fields | Units |
|---|---|---|
| Percent | `x_percent`, `y_percent`, `width_percent`, `height_percent` | 0–100 of the image size |
| Pixels | `x_px`, `y_px`, `width_px`, `height_px` | pixels from the top-left corner |
| Crop box | `crop: { x, y, width, height }` | pixels; `width`/`height` without `x`/`y` crops from the centre |

## Rules
- The origin (0, 0) is the **top-left** corner; x grows right, y grows down.
- The rectangle must lie fully inside the image: `x + width ≤ 100` (percent) or the image width (pixels),
  and the same for y.
- Never mix forms in one call.

## Common requests
- "Center square crop": use the crop box with only `width` and `height` equal to the shorter side.
- "Left half": percent form `x 0, y 0, width 50, height 100`.
- "Remove 10% border": percent form `x 10, y 10, width 80, height 80`.

If the user's request is ambiguous ("crop to the face"), ask once or choose a sensible centred crop and
say what you did.
