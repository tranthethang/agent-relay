import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
