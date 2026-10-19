import { describe, expect, it } from "vitest";

import { cropImageTool } from "@/agent/tools/cropImage";

const image_url = "https://x.test/a.jpg";
const valid = (rect: object) => cropImageTool.input.safeParse({ image_url, ...rect }).success;

describe("crop_image input: exactly one complete rectangle (brief §6)", () => {
  it.each([
    ["percent", { x_percent: 10, y_percent: 10, width_percent: 50, height_percent: 50 }],
    ["pixels", { x_px: 0, y_px: 0, width_px: 100, height_px: 80 }],
    ["a crop object", { crop: { x: 10, y: 20, width: 100, height: 80 } }],
  ])("accepts %s", (_form, rect) => {
    expect(valid(rect)).toBe(true);
  });

  it.each([
    ["no rectangle", {}],
    ["two forms", { width_percent: 50, crop: { width: 10, height: 10 } }],
    ["pixels without a height", { width_px: 100 }],
    ["a crop object without a height", { crop: { x: 0, y: 0, width: 10 } }],
    ["a zero-width crop", { crop: { width: 0, height: 10 } }],
  ])("refuses %s", (_case, rect) => {
    expect(valid(rect)).toBe(false);
  });
});
