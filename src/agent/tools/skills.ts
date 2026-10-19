import path from "node:path";

import { z } from "zod";

import { loadSkillIndex, readSkillAsset, type SkillIndex } from "@/agent/skills/registry";
import { defineTool } from "@/agent/tools/define";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { toolRepository } from "@/modules/tools/tool.repository";

let loading: Promise<SkillIndex> | undefined;

/**
 * The skills, read from `agent-skills/` once per worker process (the folder ships with the worker,
 * see trigger.config.ts). A run stays on the version it started on, so skills can't change mid-run.
 */
export function skillIndex(): Promise<SkillIndex> {
  loading ??= readSkills();
  return loading;
}

async function readSkills() {
  const { index, problems } = await loadSkillIndex(path.resolve("agent-skills"));
  for (const problem of problems) logger.warn(problem, "skill skipped");
  return index;
}

export const loadSkillTool = defineTool({
  name: "load_skill",
  description:
    "Load a skill's instructions by name before doing the task it covers. Returns the " +
    "instructions the first time; later calls in the same turn say it is already loaded.",
  input: z.object({ name: z.string().describe("A skill name from the list of available skills") }),
  output: z.object({
    name: z.string(),
    version: z.string(),
    alreadyLoaded: z.boolean(),
    instructions: z.string().optional(),
  }),
  async execute({ name }, ctx) {
    const skills = await skillIndex();
    const skill = skills.get(name);
    if (!skill) {
      const available = [...skills.keys()].join(", ");
      throw new AppError("INVALID_TOOL_INPUT", `Unknown skill "${name}". Available: ${available}.`);
    }

    // The model already has the instructions if this run loaded the skill before.
    const firstLoad = await toolRepository.loadSkillOnce(ctx.runId, skill);
    if (!firstLoad) return { name, version: skill.version, alreadyLoaded: true };
    return { name, version: skill.version, alreadyLoaded: false, instructions: skill.body };
  },
});

export const readSkillAssetTool = defineTool({
  name: "read_skill_asset",
  description:
    "Read one extra file that a skill lists (a guide or a small example). Text comes back as " +
    "text, images as base64.",
  input: z.object({
    skill: z.string(),
    path: z.string().describe("A file name the skill lists, e.g. guide.md"),
  }),
  output: z.object({
    path: z.string(),
    sha256: z.string(),
    text: z.string().optional(),
    base64: z.string().optional(),
  }),
  execute: async ({ skill, path: file }) => readSkillAsset(await skillIndex(), skill, file),
});
