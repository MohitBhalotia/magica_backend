import { z } from "zod";

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
} as const;

export type ToolName = keyof typeof TOOLS;
export type ToolKind = (typeof TOOLS)[ToolName];

export const ToolNameSchema = z.enum(Object.keys(TOOLS) as [ToolName, ...ToolName[]]);

/** AI SDK tool-part states we store and render (approval states arrive with waitpoints in M4). */
export const ToolStateSchema = z.enum([
  "input-streaming",
  "input-available",
  "output-available",
  "output-error",
]);
