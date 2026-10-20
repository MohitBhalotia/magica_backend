import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // contracts are consumed as TS source in the workspace; the published build ships dist/
  transpilePackages: ["@mohitbhalotia/magica-contracts"],
  // AGENTS.md is hand-maintained; stop `next dev` injecting its own block
  agentRules: false,
  // The API host has no pages: its root sends people to the docs.
  redirects: () =>
    Promise.resolve([
      { source: "/", destination: "https://magica-ebc2eaac.mintlify.site", permanent: false },
    ]),
};

export default nextConfig;
