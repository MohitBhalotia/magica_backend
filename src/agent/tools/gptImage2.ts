import { z } from "zod";

import { MediaToolOutputSchema } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { HttpsUrlSchema, runMediaTool } from "@/agent/tools/media";

const PRESET_SIZES = [
  "Auto",
  "1024x1024",
  "1536x1024",
  "1024x1536",
  "2048x2048",
  "2048x1152",
  "3840x2160",
  "2160x3840",
] as const;
const Side = z.int().min(1024).max(3840).multipleOf(16);

/** Magica's fields, plus `mode`, which picks the sub-model. */
const GptImageInput = z
  .object({
    mode: z.enum(["text", "edit"]).describe("text: new images; edit: change uploadedImages"),
    prompt: z.string().min(1).max(4000),
    uploadedImages: z.array(HttpsUrlSchema).min(1).max(10).optional().describe("Edit mode only"),
    size: z.union([z.enum(PRESET_SIZES), z.object({ width: Side, height: Side })]).optional(),
    // Magica defaults to High: 0.27 credits for 1024², against 0.0076 for Low.
    quality: z.enum(["Low", "Medium", "High"]).default("Low"),
    n: z.int().min(1).max(4).optional(),
    background: z.enum(["Auto", "Opaque"]).optional(),
    output_format: z.enum(["PNG", "JPEG", "WebP"]).optional(),
  })
  .refine(
    (input) => (input.mode === "edit") === (input.uploadedImages !== undefined),
    "Edit mode needs uploadedImages; text mode takes none.",
  );

/** gpt_image_2's output (docs/research/magica-raw/runs/gpt-image-2-text.run.json). */
const GptImageOutput = z.object({
  result: z.array(z.url()).min(1),
  resultMetadata: z
    .array(z.object({ width: z.number(), height: z.number(), mimeType: z.string() }))
    .default([]),
});

export const gptImage2Tool = defineTool({
  name: "gpt_image_2",
  description:
    "Generate images from a prompt, or edit images, with GPT Image 2. Load the image-generation " +
    "skill first. Quality defaults to Low; use High only when the user asks.",
  input: GptImageInput,
  output: MediaToolOutputSchema,
  execute: ({ mode, ...input }, ctx) =>
    runMediaTool(ctx, {
      job: { nodeType: "gpt_image_2", subModelId: `gpt-image-2-${mode}`, input },
      output: GptImageOutput,
      toAssets: ({ result, resultMetadata }) =>
        result.map((url, i) => ({
          kind: "image",
          url,
          mimeType: resultMetadata[i]?.mimeType ?? "image/png",
          width: resultMetadata[i]?.width,
          height: resultMetadata[i]?.height,
        })),
      prompt: input.prompt,
    }),
});
