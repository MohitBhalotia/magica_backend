import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AppError } from "@/lib/errors";

// Limits from PRD §5.7.
const TEXT_EXTENSIONS = [".md", ".txt", ".json"];
const IMAGE_EXTENSIONS = [".png", ".jpg", ".webp"];
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;

const FrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use kebab-case"),
  description: z.string().min(1).max(500),
});

export type SkillFile = { path: string; bytes: number; sha256: string };

export type Skill = {
  name: string;
  description: string;
  /** The SKILL.md instructions, without the frontmatter. */
  body: string;
  /** sha256 of SKILL.md, and its first 12 characters as a short version. */
  hash: string;
  version: string;
  dir: string;
  /** The files the agent may read. Nothing outside this list is ever served. */
  files: SkillFile[];
};

export type SkillIndex = ReadonlyMap<string, Skill>;

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Plain string order, the same on every OS (readdir's order isn't). */
const compareNames = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const extensionOf = (file: string) => path.extname(file).toLowerCase();

/**
 * Splits SKILL.md into frontmatter and body:
 *   ---
 *   name: crop-image
 *   description: …
 *   ---
 *   body
 */
export function parseSkillMarkdown(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("missing frontmatter");
  const [, frontmatter = "", body = ""] = match;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const colon = line.indexOf(":");
    if (colon < 1) throw new Error(`bad frontmatter line: ${line}`);
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { ...FrontmatterSchema.parse(fields), body: body.trim() };
}

/** The readable files of one skill folder: regular files with an allowed extension, size-capped. */
async function listFiles(dir: string): Promise<SkillFile[]> {
  const allowed = [...TEXT_EXTENSIONS, ...IMAGE_EXTENSIONS];
  const files: SkillFile[] = [];
  let totalBytes = 0;

  // isFile() is false for symlinks and folders, so neither is ever listed.
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !allowed.includes(extensionOf(entry.name))) continue;

    const content = await readFile(path.join(dir, entry.name));
    if (content.length > MAX_FILE_BYTES) throw new Error(`${entry.name} is over 256 KB`);
    totalBytes += content.length;
    if (totalBytes > MAX_SKILL_BYTES) throw new Error("skill is over 1 MB");

    files.push({ path: entry.name, bytes: content.length, sha256: sha256(content) });
  }
  return files.sort((a, b) => compareNames(a.path, b.path));
}

async function loadSkill(dir: string): Promise<Skill> {
  const markdown = await readFile(path.join(dir, "SKILL.md"), "utf8");
  const { name, description, body } = parseSkillMarkdown(markdown);
  const hash = sha256(markdown);
  return {
    name,
    description,
    body,
    hash,
    version: hash.slice(0, 12),
    dir,
    files: await listFiles(dir),
  };
}

/**
 * Indexes every `<folder>/SKILL.md` under `root` (once, at startup). A broken skill is reported in
 * `problems` and skipped, so one bad folder never takes the others down.
 */
export async function loadSkillIndex(root: string) {
  const index = new Map<string, Skill>();
  const problems: { skill: string; reason: string }[] = [];

  // Sorted, so when two folders use the same name the first one alphabetically wins.
  const folders = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareNames);

  for (const folder of folders) {
    try {
      const skill = await loadSkill(path.join(root, folder));
      if (index.has(skill.name)) throw new Error(`duplicate skill name "${skill.name}"`);
      index.set(skill.name, skill);
    } catch (err) {
      problems.push({ skill: folder, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { index: index as SkillIndex, problems };
}

/** What the model sees up front: names and descriptions only (it loads a body when needed). */
export const skillCatalog = (index: SkillIndex) =>
  [...index.values()].map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");

/**
 * One file of a skill. The name must exactly match a listed file, which also rules out paths
 * like `../secret` or `/etc/passwd`: they can never be in the list.
 */
export async function readSkillAsset(index: SkillIndex, skillName: string, fileName: string) {
  const skill = index.get(skillName);
  if (!skill) throw new AppError("INVALID_TOOL_INPUT", `Skill "${skillName}" not found.`);

  const file = skill.files.find((f) => f.path === fileName);
  if (!file) {
    const available = skill.files.map((f) => f.path).join(", ");
    throw new AppError("INVALID_TOOL_INPUT", `File "${fileName}" not found. Files: ${available}.`);
  }

  const content = await readFile(path.join(skill.dir, file.path));
  const isText = TEXT_EXTENSIONS.includes(extensionOf(file.path));
  return isText
    ? { path: file.path, sha256: file.sha256, text: content.toString("utf8") }
    : { path: file.path, sha256: file.sha256, base64: content.toString("base64") };
}
