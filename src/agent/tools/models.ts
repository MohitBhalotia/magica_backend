import { z } from "zod";

import type { ToolName } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { magica } from "@/providers/magica";

/** Magica models (and sub-models) the agent has a tool for. */
const RUNNABLE: Record<string, ToolName> = {
  crop_image: "crop_image",
  gpt_image_2: "gpt_image_2",
  "gpt-image-2-text": "gpt_image_2",
  "gpt-image-2-edit": "gpt_image_2",
  merge_videos: "merge_videos",
};

/** Enough results to choose from, without flooding the model's context. */
const MAX_RESULTS = 20;

const ModelSchema = z.object({
  modelId: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  /** True when the agent has a tool for this model; only those can be used here. */
  runnable: z.boolean(),
  tool: z.string().optional(),
});

export const searchModelsTool = defineTool({
  name: "search_models",
  description:
    'Search Magica\'s media models by what you want to do, e.g. "crop image" or "text to image". ' +
    "Only models marked runnable can be used here, through the tool named in `tool`.",
  input: z.object({ query: z.string().min(1).max(200) }),
  output: z.object({
    models: z.array(ModelSchema),
    categoryRoles: z.record(z.string(), z.string()),
    noMatch: z.string().optional(),
  }),
  async execute({ query }, ctx) {
    const result = await magica.searchModels(query, ctx.signal);
    const models = Object.values(result.modelCatalog)
      .flat()
      .map((model) => ({
        ...model,
        runnable: model.modelId in RUNNABLE,
        tool: RUNNABLE[model.modelId],
      }))
      // Runnable models first: those are the ones the agent can actually call.
      .sort((a, b) => Number(b.runnable) - Number(a.runnable))
      .slice(0, MAX_RESULTS);

    // Magica's `usage` text is a playbook for its own MCP clients (tools we don't have), so it isn't
    // passed on.
    return { models, categoryRoles: result.categoryRoles, noMatch: result.noMatch };
  },
});

export const getModelSchemaTool = defineTool({
  name: "get_model_schema",
  description:
    "Get a Magica model's live input fields (names, types, limits, options, defaults). Call this " +
    "before using a media tool, and fill its inputs from these fields.",
  input: z.object({
    modelId: z.string().min(1).describe('e.g. "crop_image" or "gpt-image-2-text"'),
  }),
  // Passed through as Magica returns it.
  output: z.looseObject({ modelId: z.string(), fields: z.array(z.unknown()) }),
  execute: ({ modelId }, ctx) => magica.modelSchema(modelId, ctx.signal),
});
