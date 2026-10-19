export { createCompletion as POST } from "@/modules/completions/completion.controller";

// A streamed reply can run to the function's limit (the stream ends just before it).
export const maxDuration = 300;
