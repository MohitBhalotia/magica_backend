/**
 * CORS headers for a request's Origin: only allow-listed frontends get any. Auth is a Bearer token
 * (not cookies), so no Allow-Credentials. Unknown origins get nothing and the browser blocks them.
 */
export function corsHeaders(
  origin: string | null,
  allowed: readonly string[],
): Record<string, string> {
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Expose-Headers": "X-Trace-Id, Retry-After",
    "Access-Control-Max-Age": "86400", // browsers cache the preflight for a day
    Vary: "Origin",
  };
}
