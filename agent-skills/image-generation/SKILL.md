---
name: image-generation
description: Prompting, sizes, quality, cost and text-vs-edit guidance for GPT Image 2 (gpt_image_2).
---
# Generating images with GPT Image 2

## Text or edit
- `mode: "text"` creates new images from a prompt.
- `mode: "edit"` changes existing images: pass 1–10 `uploadedImages` URLs (required) and optionally a
  `mask`. Describe the change, not the whole image.

## Prompts
- Lead with the subject, then setting, style, lighting and composition: "A red apple on a white marble
  counter, soft morning light, top-down product shot".
- Put any text that must appear in the image in quotes and keep it short.
- 1–4000 characters. Specific beats long.

## Size and count
- Sizes: `Auto`, `1024x1024`, `1536x1024` (landscape), `1024x1536` (portrait), `2048x2048`,
  `2048x1152`, `3840x2160`, `2160x3840`, or `Custom` with `width`/`height`.
- `n` is 1–4. Generate one unless the user asks for options.

## Quality and cost
- `quality`: `Low`, `Medium` or `High`. **Default to `Low`**: about 0.008M credits for 1024×1024,
  while `High` is roughly 35× more. Use `High` only when the user asks for it.
- `output_format`: `PNG` (default), `JPEG` or `WebP`.

## After generating
Describe what you made in one or two sentences. Don't paste image URLs into the text; the image is
shown inline.
