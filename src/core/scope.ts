import { normalizePath, pathsOverlap } from "./overlap.js";

const runRoot = ".agent-relay";

export function outsidePaths(
  changed: readonly string[],
  own: readonly string[],
  others: readonly string[],
): string[] {
  const outside: string[] = [];
  const seen = new Set<string>();
  for (const raw of changed) {
    const path = normalizePath(raw);
    if (path === runRoot || path.startsWith(`${runRoot}/`)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const covered = [...own, ...others].some((entry) => pathsOverlap(path, entry));
    if (!covered) outside.push(path);
  }
  outside.sort((left, right) => left.localeCompare(right));
  return outside;
}
