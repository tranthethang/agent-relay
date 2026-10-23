import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { atomicWrite, isEnoent, joinUnder, readJson } from "./files.js";
import { schemaVersion } from "./vocab.js";

const manifestRel = "90-distill/manifest.json";

export const distillFileSchema = z.object({
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export const distillManifestSchema = z.object({
  schema: z.literal(schemaVersion),
  files: z.array(distillFileSchema),
}).strict();

export type DistillManifest = z.infer<typeof distillManifestSchema>;

export type DistillResult = {
  schema: 1;
  path: string;
  files: number;
};

export type DistillOptions = {
  includeTestLogs?: boolean;
};

export type DistillVerifyResult = {
  schema: 1;
  ok: boolean;
  files: number;
  missing: string[];
  mismatched: string[];
};

export function distillText(result: DistillResult): string {
  return `${result.path}\nfiles: ${result.files}\n`;
}

export function distillVerifyText(result: DistillVerifyResult): string {
  const lines = [`ok: ${result.ok ? "yes" : "no"}`, `files: ${result.files}`];
  for (const path of result.missing) lines.push(`missing: ${path}`);
  for (const path of result.mismatched) lines.push(`mismatched: ${path}`);
  return `${lines.join("\n")}\n`;
}

export async function verifyDistill(runDir: string): Promise<DistillVerifyResult> {
  const manifest = await readManifest(runDir);
  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const file of manifest.files) {
    const full = joinUnder(runDir, file.path);
    let data: Buffer;
    try {
      data = await readFile(full);
    } catch (error) {
      if (isEnoent(error)) {
        missing.push(file.path);
        continue;
      }
      throw error;
    }
    const sha256 = createHash("sha256").update(data).digest("hex");
    if (data.byteLength !== file.size || sha256 !== file.sha256) mismatched.push(file.path);
  }
  return {
    schema: schemaVersion,
    ok: missing.length === 0 && mismatched.length === 0,
    files: manifest.files.length,
    missing,
    mismatched,
  };
}

async function readManifest(runDir: string): Promise<DistillManifest> {
  const path = join(runDir, manifestRel);
  let value: unknown;
  try {
    value = await readJson(path);
  } catch (error) {
    if (isEnoent(error)) throw new RelayError("not_found", "manifest not found", manifestRel);
    throw error;
  }
  const parsed = distillManifestSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = fromZod(parsed.error);
  throw new RelayError(
    "validation",
    issue.message,
    issue.fieldPath.length === 0 ? manifestRel : `${manifestRel}:${issue.fieldPath}`,
  );
}

export async function distillRun(
  runDir: string,
  options: DistillOptions = {},
): Promise<DistillResult> {
  const listed = await listFiles(runDir);
  const files: DistillManifest["files"] = [];
  for (const file of listed) {
    const path = relative(runDir, file).split(sep).join("/");
    if (path === manifestRel) continue;
    if (options.includeTestLogs !== true && path.endsWith(".test.log")) continue;
    const data = await readFile(file);
    files.push({
      path,
      size: data.byteLength,
      sha256: createHash("sha256").update(data).digest("hex"),
    });
  }
  files.sort((left, right) => comparePath(left.path, right.path));
  const manifest = distillManifestSchema.parse({ schema: schemaVersion, files });
  const path = join(runDir, manifestRel);
  await mkdir(join(runDir, "90-distill"), { recursive: true });
  await atomicWrite(path, `${JSON.stringify(manifest)}\n`);
  return { schema: schemaVersion, path, files: files.length };
}

function comparePath(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, root, out);
  return out;
}

async function walk(root: string, dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === root && entry.name === "locks") continue;
      await walk(root, path, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".") && entry.name.endsWith(".tmp")) continue;
    out.push(path);
  }
}
