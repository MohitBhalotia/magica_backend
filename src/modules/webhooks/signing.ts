import { createHmac, randomBytes } from "node:crypto";

/** A new signing secret in the Standard Webhooks format: `whsec_` + base64 of 24 random bytes. */
export const newSecret = () => `whsec_${randomBytes(24).toString("base64")}`;

/**
 * Standard Webhooks headers (https://www.standardwebhooks.com): the signature is
 * `v1,` + base64(HMAC-SHA256(secret bytes, `${id}.${timestamp}.${body}`)). Receivers verify it
 * with any Standard Webhooks library, e.g. `new Webhook(secret).verify(body, headers)`.
 */
export function signedHeaders(secret: string, id: string, body: string, now = new Date()) {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": `v1,${signature}`,
  };
}
