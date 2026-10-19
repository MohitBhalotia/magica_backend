import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadSkillIndex,
  parseSkillMarkdown,
  readSkillAsset,
  skillCatalog,
} from "@/agent/skills/registry";

const skillMd = (name: string, description = `About ${name}.`) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\nBody of ${name}.\n`;

let root: string;
async function addSkill(folder: string, files: Record<string, string | Buffer>) {
  await mkdir(path.join(root, folder), { recursive: true });
  for (const [file, content] of Object.entries(files))
    await writeFile(path.join(root, folder, file), content);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "skills-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the shipped skills", () => {
  it("all load with valid frontmatter and no problems", async () => {
    const { index, problems } = await loadSkillIndex(path.resolve("agent-skills"));
    expect(problems).toEqual([]);
    expect([...index.keys()].sort()).toEqual([
      "crop-image",
      "image-generation",
      "model-pick-contract",
      "video-merge",
    ]);
  });
});

describe("loadSkillIndex", () => {
  it("indexes name, description, body, version and file hashes; the catalog lists only descriptions", async () => {
    await addSkill("crop", { "SKILL.md": skillMd("crop-image"), "rules.txt": "x" });
    const { index } = await loadSkillIndex(root);
    const skill = index.get("crop-image");

    expect(skill).toMatchObject({
      description: "About crop-image.",
      body: "# crop-image\nBody of crop-image.",
    });
    expect(skill?.version).toHaveLength(12);
    expect(skill?.files.map((f) => f.path)).toEqual(["SKILL.md", "rules.txt"]);
    expect(skillCatalog(index)).toBe("- crop-image: About crop-image.");
  });

  it("skips bad frontmatter, duplicate names and oversize files instead of failing", async () => {
    await addSkill("good", { "SKILL.md": skillMd("good-one") });
    await addSkill("no-frontmatter", { "SKILL.md": "# just markdown" });
    await addSkill("bad-name", { "SKILL.md": skillMd("Bad Name") });
    await addSkill("zz-dupe", { "SKILL.md": skillMd("good-one") });
    await addSkill("big", { "SKILL.md": skillMd("big-one"), "huge.txt": "x".repeat(257 * 1024) });

    const { index, problems } = await loadSkillIndex(root);

    expect([...index.keys()]).toEqual(["good-one"]);
    expect(problems.map((p) => p.skill).sort()).toEqual([
      "bad-name",
      "big",
      "no-frontmatter",
      "zz-dupe",
    ]);
    expect(problems.find((p) => p.skill === "zz-dupe")?.reason).toContain("duplicate");
  });

  it("ignores files with extensions outside the allowlist", async () => {
    await addSkill("s", { "SKILL.md": skillMd("s"), "run.sh": "rm -rf /", "notes.md": "ok" });
    const { index } = await loadSkillIndex(root);
    expect(index.get("s")?.files.map((f) => f.path)).toEqual(["SKILL.md", "notes.md"]);
  });
});

describe("parseSkillMarkdown", () => {
  it("rejects a missing or malformed frontmatter block", () => {
    expect(() => parseSkillMarkdown("no frontmatter")).toThrow("missing frontmatter");
    expect(() => parseSkillMarkdown("---\njust words\n---\nbody")).toThrow("bad frontmatter line");
  });
});

describe("readSkillAsset", () => {
  beforeEach(async () => {
    await addSkill("s", {
      "SKILL.md": skillMd("s"),
      "guide.md": "# Guide",
      "logo.png": Buffer.from([1, 2]),
    });
    await writeFile(path.join(root, "secret.txt"), "outside");
  });

  it("returns text files as text and images as base64", async () => {
    const { index } = await loadSkillIndex(root);
    expect(await readSkillAsset(index, "s", "guide.md")).toMatchObject({ text: "# Guide" });
    expect(await readSkillAsset(index, "s", "logo.png")).toMatchObject({ base64: "AQI=" });
  });

  it("refuses paths outside the skill, absolute paths, NUL bytes and unknown skills or files", async () => {
    const { index } = await loadSkillIndex(root);
    for (const bad of [
      "../secret.txt",
      "../../etc/passwd",
      path.join(root, "secret.txt"),
      "guide.md\0.png",
    ])
      await expect(readSkillAsset(index, "s", bad)).rejects.toMatchObject({
        code: "INVALID_TOOL_INPUT",
      });
    await expect(readSkillAsset(index, "s", "missing.md")).rejects.toThrow("not found");
    await expect(readSkillAsset(index, "nope", "guide.md")).rejects.toThrow("not found");
  });
});
