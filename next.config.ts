import type { NextConfig } from "next";

// contracts are consumed as TS source in the workspace; the published build ships dist/
const nextConfig: NextConfig = { transpilePackages: ["@agent-chat/contracts"] };

export default nextConfig;
