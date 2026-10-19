import { AwsClient } from "aws4fetch";
import { z } from "zod";

/** The private bucket's settings; both the API and the worker sign links, so both need them. */
export const R2EnvSchema = z.object({
  R2_ACCOUNT_ID: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/),
  R2_BUCKET: z.string().trim().min(3),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().trim().min(1),
});

/** Signed links are short-lived: long enough to view or download, and for Magica to fetch. */
const LINK_TTL_SECONDS = 60 * 60;

// Built on first use, not at import: the worker loads this file before its env is checked.
let r2: { env: z.infer<typeof R2EnvSchema>; client: AwsClient } | undefined;
function bucket() {
  if (!r2) {
    const env = R2EnvSchema.parse(process.env);
    const client = new AwsClient({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      service: "s3",
      region: "auto",
    });
    r2 = { env, client };
  }
  return r2;
}

/** Where an attachment lives in the private bucket. Fixed up front, so nothing has to parse it. */
export const attachmentKey = (userId: string, attachmentId: string) =>
  `uploads/${userId}/${attachmentId}`;

/** A short-lived link to a private object; downloads keep the file's original name. */
export async function signedUrl(key: string, fileName: string) {
  const { env, client } = bucket();
  const url = new URL(
    `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${key}`,
  );
  url.searchParams.set("X-Amz-Expires", String(LINK_TTL_SECONDS));
  url.searchParams.set(
    "response-content-disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  );
  const signed = await client.sign(url.toString(), { aws: { signQuery: true } });
  return signed.url;
}
