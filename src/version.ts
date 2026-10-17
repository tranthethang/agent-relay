import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const versionJsonSchema = z.object({
  schema: z.literal(1),
  version: z.string().min(1),
}).strict();

export function packageVersion(moduleUrl: string = import.meta.url): string {
  const pkgPath = join(dirname(fileURLToPath(moduleUrl)), "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error("package.json version is missing");
  }
  return pkg.version;
}

export function versionText(version: string): string {
  return `${version}\n`;
}

export function versionJson(version: string): string {
  const value = versionJsonSchema.parse({ schema: 1, version });
  return `${JSON.stringify(value)}\n`;
}
