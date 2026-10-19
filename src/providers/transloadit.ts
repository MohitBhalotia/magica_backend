import crypto from "node:crypto";

import { z } from "zod";

import { MAX_UPLOAD_BYTES } from "@mohitbhalotia/magica-contracts";

/*
 * Transloadit (https://transloadit.com/docs) receives uploads from Uppy and stores them in R2.
 * The auth secret never leaves this file: it signs upload jobs and checks webhook signatures.
 */

export const TransloaditEnvSchema = z.object({
  TRANSLOADIT_KEY: z.string().trim().min(1),
  TRANSLOADIT_SECRET: z.string().trim().min(1),
});
// Read on first use, not at import: the worker loads this file (through the chat service) without
// the API's env, and never signs uploads.
let parsed: z.infer<typeof TransloaditEnvSchema> | undefined;
const env = () => (parsed ??= TransloaditEnvSchema.parse(process.env));

const API = "https://api2.transloadit.com";
/** The Template Credential holding the R2 bucket and token (created in the Transloadit account). */
const R2_CREDENTIALS = "magica-uploads";
/** How long the browser has to start the upload with these options. */
const SIGNATURE_TTL_MS = 30 * 60_000;

/** This auth key requires sha256 signatures (Transloadit rejects sha1/sha384 for it). */
const sign = (payload: string) =>
  `sha256:${crypto.createHmac("sha256", env().TRANSLOADIT_SECRET).update(payload).digest("hex")}`;

/**
 * Signed options for one file: keep it only if it's an image, video or audio file, then store it in
 * the private R2 bucket at `key`. `notifyUrl` is our webhook; the job carries the attachment's id.
 */
export function uploadOptions(input: { attachmentId: string; key: string; notifyUrl: string }) {
  const params = JSON.stringify({
    auth: {
      key: env().TRANSLOADIT_KEY,
      expires: new Date(Date.now() + SIGNATURE_TTL_MS).toISOString(),
      max_size: MAX_UPLOAD_BYTES,
    },
    steps: {
      ":original": { robot: "/upload/handle" },
      accepted: {
        robot: "/file/filter",
        use: ":original",
        accepts: [["${file.mime}", "regex", "^(image|video|audio)/"]],
      },
      stored: {
        robot: "/cloudflare/store",
        use: "accepted",
        credentials: R2_CREDENTIALS,
        path: input.key,
      },
    },
    fields: { attachment_id: input.attachmentId },
    notify_url: input.notifyUrl,
  });
  return { params, signature: sign(params) };
}

/** A webhook is genuine only if its signature matches the payload under our secret. */
export function isSignedByTransloadit(payload: string, signature: string) {
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/** The parts of a job's status we use. */
export const AssemblySchema = z.looseObject({
  assembly_id: z.string(),
  ok: z.string().optional(),
  error: z.string().optional(),
  fields: z.record(z.string(), z.unknown()).default({}),
  results: z
    .record(
      z.string(),
      z.array(
        z.looseObject({
          size: z.number().optional(),
          mime: z.string().optional(),
          meta: z
            .looseObject({
              width: z.number().nullish(),
              height: z.number().nullish(),
              /** Seconds. */
              duration: z.number().nullish(),
            })
            .default({}),
        }),
      ),
    )
    .default({}),
});
export type Assembly = z.infer<typeof AssemblySchema>;

/** A job's current status, read from Transloadit (used when the webhook is late or missed). */
export async function getAssembly(assemblyId: string): Promise<Assembly> {
  const response = await fetch(`${API}/assemblies/${encodeURIComponent(assemblyId)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  return AssemblySchema.parse(await response.json());
}
