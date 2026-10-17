import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_enrkafhghnkkyuxikygt",
  dirs: ["./src/trigger"],
  // Agent turns can wait minutes on tools and approvals; waits don't count toward this (checkpointed).
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
