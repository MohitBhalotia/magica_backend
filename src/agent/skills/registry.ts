import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { AppError } from "@/lib/errors";

/** Skill files the agent may read (PRD §5.7). Everything else in a skill folder is ignored. */
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".json"]);
const ALLOWED_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ".png", ".jpg", ".webp"]);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_SKILL_BYTES = 1024 * 1024;
const SKILL_FILE = "SKILL.md";

const FrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "kebab-case"),
  description: z.string().min(1).max(500),
});

export type SkillFile = { path: string; bytes: number; sha256: string };

export type Skill = {
  name: string;
  description: string;
  /** Content version: the first 12 hex chars of SKILL.md's sha256. */
  version: string;
  /** sha256 of SKILL.md; saved per run so a resumed run re-injects the same text. */
  hash: string;
  body: string;
  dir: string;
  files: SkillFile[];
};

export type SkillIndex = ReadonlyMap<string, Skill>;

type Problem = { skill: string; reason: string };

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
/** Code-unit order, the same on every OS (readdir order isn't guaranteed). */
const byName =
  <T>(key: (item: T) => string) =>
  (a: T, b: T) =>
    key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;

/** `---\nname: x\ndescription: y\n---\nbody`: flat string keys only, validated with Zod. */
export function parseSkillMarkdown(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) throw new Error("missing frontmatter");
  const [, head = "", body = ""] = match;
  const fields = Object.fromEntries(
    head
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const at = line.indexOf(":");
        if (at < 1) throw new Error(`bad frontmatter line: ${line}`);
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
  return { ...FrontmatterSchema.parse(fields), body: body.trim() };
}

/** Flat file list of one skill folder, symlinks excluded, with the size limits applied. */
async function listFiles(dir: string): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !ALLOWED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      continue;
    const content = await readFile(path.join(dir, entry.name));
    if (content.length > MAX_FILE_BYTES) throw new Error(`${entry.name} is over 256 KB`);
    total += content.length;
    if (total > MAX_SKILL_BYTES) throw new Error("skill is over 1 MB");
    files.push({ path: entry.name, bytes: content.length, sha256: sha256(content) });
  }
  return files.sort(byName((f) => f.path));
}

/**
 * Scans `root` once (at startup): every `<name>/SKILL.md` with valid frontmatter becomes a skill.
 * Duplicates, bad frontmatter and oversize files are reported and skipped, never fatal.
 */
export async function loadSkillIndex(
  root: string,
): Promise<{ index: SkillIndex; problems: Problem[] }> {
  const index = new Map<string, Skill>();
  const problems: Problem[] = [];
  // Sorted, so with a duplicate name the first folder alphabetically always wins.
  const folders = (await readdir(root, { withFileTypes: true })).sort(byName((e) => e.name));
  for (const entry of folders) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    try {
      const raw = await readFile(path.join(dir, SKILL_FILE), "utf8");
      const { name, description, body } = parseSkillMarkdown(raw);
      if (index.has(name)) throw new Error(`duplicate skill name "${name}"`);
      const hash = sha256(raw);
      index.set(name, {
        name,
        description,
        version: hash.slice(0, 12),
        hash,
        body,
        dir,
        files: await listFiles(dir),
      });
    } catch (err) {
      problems.push({
        skill: entry.name,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { index, problems };
}

/** The base prompt carries only this list; the model loads a skill's body when it needs it. */
export const skillCatalog = (index: SkillIndex) =>
  [...index.values()].map((s) => `- ${s.name}: ${s.description}`).join("\n");

const notFound = (what: string) => new AppError("INVALID_TOOL_INPUT", `${what} not found.`);

/**
 * One file of a skill, guarded: the path must be a plain relative name inside the skill folder,
 * listed in the index (allowed extension, size checked), and not a symlink.
 */
export async function readSkillAsset(index: SkillIndex, skillName: string, filePath: string) {
  const skill = index.get(skillName);
  if (!skill) throw notFound(`Skill "${skillName}"`);
  const normalized = path.normalize(filePath);
  const target = path.resolve(skill.dir, normalized);
  const inside = target.startsWith(skill.dir + path.sep);
  if (
    filePath.includes("\0") ||
    path.isAbsolute(filePath) ||
    normalized.startsWith("..") ||
    !inside
  )
    throw new AppError("INVALID_TOOL_INPUT", "That path is outside the skill.");
  const file = skill.files.find((f) => f.path === path.relative(skill.dir, target));
  if (!file) throw notFound(`File "${filePath}"`);
  if ((await lstat(target)).isSymbolicLink()) throw notFound(`File "${filePath}"`);
  const content = await readFile(target);
  return TEXT_EXTENSIONS.has(path.extname(file.path).toLowerCase())
    ? { path: file.path, sha256: file.sha256, text: content.toString("utf8") }
    : { path: file.path, sha256: file.sha256, base64: content.toString("base64") };
}
