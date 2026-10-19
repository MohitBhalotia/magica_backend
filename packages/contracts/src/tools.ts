import { z } from "zod";

import { pageSchema } from "./pagination.ts";

/**
 * Every tool the agent can call, with the kind that picks its UI row (PRD §5.5). The backend's
 * `defineTool` registry and the frontend's renderer registry both key off this one map.
 */
export const TOOLS = {
  load_skill: "skill",
  read_skill_asset: "skill",
  search_models: "discovery",
  get_model_schema: "discovery",
  crop_image: "media",
  gpt_image_2: "media",
  merge_videos: "media",
  /** They pause the run on a waitpoint until the user answers (M4b). */
  ask_user: "interaction",
  propose_plan: "interaction",
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolKind = (typeof TOOLS)[ToolName];

export const ToolNameSchema = z.enum(Object.keys(TOOLS) as [ToolName, ...ToolName[]]);

/** One image or video a media tool produced (also saved as an `Asset` row). */
export const MediaAssetSchema = z.object({
  kind: z.enum(["image", "video"]),
  url: z.string(),
  mimeType: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationMs: z.number().optional(),
  sizeBytes: z.number().optional(),
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

/** What `crop_image`, `gpt_image_2` and `merge_videos` return; `creditUsed` is in microcredits. */
export const MediaToolOutputSchema = z.object({
  assets: z.array(MediaAssetSchema),
  creditUsed: z.number(),
});
export type MediaToolOutput = z.infer<typeof MediaToolOutputSchema>;

/** A file in the chat's files modal (DESIGN §4.8): one saved asset, newest first. */
export const ChatAssetSchema = MediaAssetSchema.extend({
  id: z.string(),
  prompt: z.string().nullable(),
  model: z.string(),
  createdAt: z.iso.datetime(),
});
export type ChatAsset = z.infer<typeof ChatAssetSchema>;

export const ChatAssetListSchema = pageSchema(ChatAssetSchema);
export type ChatAssetList = z.infer<typeof ChatAssetListSchema>;

/** AI SDK tool-part states we store and render (approval states arrive with waitpoints in M4). */
export const ToolStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
]);
