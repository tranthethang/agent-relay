import { createHash } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { atomicWrite } from "./files.js";
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

export function distillText(result: DistillResult): string {
  return `${result.path}\nfiles: ${result.files}\n`;
}

export async function distillRun(runDir: string): Promise<DistillResult> {
  const listed = await listFiles(runDir);
  const files: DistillManifest["files"] = [];
  for (const file of listed) {
    const path = relative(runDir, file).split(sep).join("/");
    if (path === manifestRel) continue;
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
  await walk(root, out);
  return out;
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(path, out);
      continue;
    }
    if (entry.isFile()) out.push(path);
  }
}
