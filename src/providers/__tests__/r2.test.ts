import { describe, expect, it } from "vitest";

import { toStored } from "@/agent/turn";
import { withoutSignatures } from "@/providers/r2";

const bare = "https://0123abcd.r2.cloudflarestorage.com/magica/uploads/user_1/att_1";
const signed = `${bare}?X-Amz-Expires=3600&X-Amz-Credential=AKIA%2F20261019%2Fauto&X-Amz-Signature=abc123`;

describe("withoutSignatures", () => {
  it("cuts signed R2 links to their path anywhere in a nested value", () => {
    expect(
      withoutSignatures({
        image_url: signed,
        uploadedImages: [signed, { url: signed }],
        prompt: `see ${signed} please`,
        n: 1,
      }),
    ).toEqual({
      image_url: bare,
      uploadedImages: [bare, { url: bare }],
      prompt: `see ${bare} please`,
      n: 1,
    });
  });

  it("leaves other links and plain values alone", () => {
    const value = { url: "https://cdn.magica.com/a.png?w=1", bare, n: null };
    expect(withoutSignatures(value)).toEqual(value);
    expect(withoutSignatures<unknown>(undefined)).toBeUndefined();
  });

  it("strips signed links from saved tool blocks", () => {
    const { blocks } = toStored({
      id: "m1",
      role: "assistant",
      parts: [
        {
          type: "tool-crop_image",
          toolCallId: "c1",
          state: "output-available",
          input: { image_url: signed },
          output: { url: "https://cdn.magica.com/out.png" },
        },
      ],
    });
    expect(blocks[0]).toMatchObject({
      input: { image_url: bare },
      output: { url: "https://cdn.magica.com/out.png" },
    });
  });
});
