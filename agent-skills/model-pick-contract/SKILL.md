---
name: model-pick-contract
description: How to choose a Magica model for a media task and confirm its live input schema before calling it.
---
# Picking a Magica model

Follow this contract before any media tool call.

1. **Find candidates.** Call `search_models` with a short query describing the job ("crop image",
   "text to image", "merge videos"). Prefer models whose name and description match the task exactly.
2. **Confirm the schema.** Call `get_model_schema` for the model you picked. Use the returned fields,
   types, limits and defaults; never rely on remembered parameters, because providers change them.
3. **Fill required fields only.** Leave optional fields at their defaults unless the user asked for
   something specific (size, count, style).
4. **Prefer cheap settings.** Use the lowest quality that satisfies the request (for GPT Image 2 that is
   `quality: Low`) unless the user explicitly asks for higher quality.
5. **One call per intent.** Don't re-run a tool to "try again" without a reason; explain failures to the
   user and suggest a concrete change instead.

The supported tools are `crop_image`, `gpt_image_2` (`text` or `edit`) and `merge_videos`. If none fits,
say what you can do instead.
