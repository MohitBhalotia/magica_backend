import { z } from "zod";

import { MediaToolOutputSchema } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { HttpsUrlSchema, runMediaTool } from "@/agent/tools/media";

const Percent = z.number().min(0).max(100);
const Pixels = z.int().min(0);

const PERCENT_FIELDS = ["x_percent", "y_percent", "width_percent", "height_percent"] as const;
const PIXEL_FIELDS = ["x_px", "y_px", "width_px", "height_px"] as const;

const ONE_FORM =
  "Use exactly one form: the *_percent fields, width_px and height_px (x_px/y_px optional), " +
  "or crop {x, y, width, height}.";

/** Field names are Magica's, so its validation messages make sense to the model. */
const CropInput = z
  .object({
    image_url: HttpsUrlSchema,
    x_percent: Percent.optional(),
    y_percent: Percent.optional(),
    width_percent: Percent.optional(),
    height_percent: Percent.optional(),
    x_px: Pixels.optional(),
    y_px: Pixels.optional(),
    width_px: Pixels.min(1).optional(),
    height_px: Pixels.min(1).optional(),
    /** Magica's third form (brief): a pixel rectangle as one object. */
    crop: z
      .object({
        x: Pixels.optional(),
        y: Pixels.optional(),
        width: Pixels.min(1),
        height: Pixels.min(1),
      })
      .optional(),
  })
  .refine((input) => {
    const percent = PERCENT_FIELDS.some((field) => input[field] !== undefined);
    const pixels = PIXEL_FIELDS.some((field) => input[field] !== undefined);
    if ([percent, pixels, input.crop !== undefined].filter(Boolean).length !== 1) return false;
    return !pixels || (input.width_px !== undefined && input.height_px !== undefined);
  }, ONE_FORM);

/** crop_image's output (docs/research/magica-raw/runs/crop_image.run.json). */
const CropOutput = z.object({ image_url: z.url(), width: z.number(), height: z.number() });

export const cropImageTool = defineTool({
  name: "crop_image",
  description:
    "Crop an image (public HTTPS URL) by percent, by pixels, or by a crop {x, y, width, height} " +
    "rectangle. Load the crop-image skill first.",
  input: CropInput,
  output: MediaToolOutputSchema,
  execute: (input, ctx) =>
    runMediaTool(ctx, {
      job: { nodeType: "crop_image", input },
      output: CropOutput,
      toAssets: ({ image_url, width, height }) => [
        { kind: "image", url: image_url, mimeType: imageMimeType(image_url), width, height },
      ],
    }),
});

/** Magica doesn't send the crop's type; its URL ends in the format (".png"). */
function imageMimeType(url: string) {
  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
  return extension === "jpg" ? "image/jpeg" : `image/${extension ?? "png"}`;
}
