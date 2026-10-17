import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // contracts are consumed as TS source in the workspace; the published build ships dist/
  transpilePackages: ["@agent-chat/contracts"],
  // AGENTS.md is hand-maintained; stop `next dev` injecting its own block
  agentRules: false,
};

export default nextConfig;
