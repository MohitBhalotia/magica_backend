import type { RegisteredTool } from "@/agent/tools/define";
import { loadSkillTool, readSkillAssetTool } from "@/agent/tools/skills";

/** Every tool the agent can call. Adding a tool: one file with defineTool, plus a line here. */
export const AGENT_TOOLS: readonly RegisteredTool[] = [loadSkillTool, readSkillAssetTool];
