import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const devMarker = "-dev";

export function isDevVersion(version: string): boolean {
  return version.includes(devMarker);
}

// The build writes `dist/package.json` next to the bundle, because the git
// `package.json` stays at `0.0.0`. A source run falls back to the repo file.
export function packageVersion(moduleUrl: string = import.meta.url): string {
  const dir = dirname(fileURLToPath(moduleUrl));
  for (const candidate of [join(dir, "package.json"), join(dir, "..", "package.json")]) {
    const version = readVersion(candidate);
    if (version !== undefined) return version;
  }
  throw new Error("package.json version is missing");
}

function readVersion(path: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
  let pkg: { version?: unknown };
  try {
    pkg = JSON.parse(text) as { version?: unknown };
  } catch {
    return undefined;
  }
  return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : undefined;
}

export function versionText(version: string): string {
  const marker = isDevVersion(version) ? "dev build\n" : "";
  return `${version}\n${marker}`;
}
