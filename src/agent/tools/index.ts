import { askUserTool } from "@/agent/tools/askUser";
import { cropImageTool } from "@/agent/tools/cropImage";
import type { RegisteredTool } from "@/agent/tools/define";
import { gptImage2Tool } from "@/agent/tools/gptImage2";
import { mergeVideosTool } from "@/agent/tools/mergeVideos";
import { getModelSchemaTool, searchModelsTool } from "@/agent/tools/models";
import { proposePlanTool } from "@/agent/tools/proposePlan";
import { loadSkillTool, readSkillAssetTool } from "@/agent/tools/skills";

/** Every tool the agent can call. Adding a tool: one file with defineTool, plus a line here. */
export const AGENT_TOOLS: readonly RegisteredTool[] = [
  loadSkillTool,
  readSkillAssetTool,
  searchModelsTool,
  getModelSchemaTool,
  cropImageTool,
  gptImage2Tool,
  mergeVideosTool,
  askUserTool,
  proposePlanTool,
];
