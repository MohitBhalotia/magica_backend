import { z } from "zod";

import { MediaToolOutputSchema } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { HttpsUrlSchema, runMediaTool } from "@/agent/tools/media";

/** merge_videos's output (docs/research/magica-raw/runs/merge_videos.run.json). */
const MergeOutput = z.object({
  video_url: z.url(),
  mimeType: z.string().default("video/mp4"),
  width: z.number().optional(),
  height: z.number().optional(),
  /** Seconds. */
  duration: z.number().optional(),
  fileSize: z.number().optional(),
});

export const mergeVideosTool = defineTool({
  name: "merge_videos",
  description:
    "Join 2–100 videos (public HTTPS URLs) into one, in the order given. Load the video-merge " +
    "skill first.",
  input: z.object({
    video_urls: z.array(HttpsUrlSchema).min(2).max(100),
    transition: z.enum(["none", "fade", "dissolve"]).default("none"),
  }),
  output: MediaToolOutputSchema,
  execute: (input, ctx) =>
    runMediaTool(ctx, {
      job: { nodeType: "merge_videos", input },
      output: MergeOutput,
      toAssets: ({ video_url, mimeType, width, height, duration, fileSize }) => [
        {
          kind: "video",
          url: video_url,
          mimeType,
          width,
          height,
          durationMs: duration === undefined ? undefined : Math.round(duration * 1000),
          sizeBytes: fileSize,
        },
      ],
    }),
});
