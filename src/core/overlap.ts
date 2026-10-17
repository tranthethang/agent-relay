import { RelayError } from "./error.js";
import { type PlanIndex } from "./tasks.js";

export function normalizePath(input: string): string {
  const slashed = input.replaceAll("\\", "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) {
    throw new RelayError("validation", "path leaves the repo", "files");
  }
  const parts: string[] = [];
  for (const part of slashed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) {
        throw new RelayError("validation", "path leaves the repo", "files");
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    throw new RelayError("validation", "path is empty", "files");
  }
  return parts.join("/");
}

export function pathsOverlap(left: string, right: string): boolean {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function overlappingTask(
  tasks: PlanIndex["tasks"],
  taskId: string,
  heldIds: ReadonlySet<string>,
): string | null {
  const current = tasks.find((task) => task.id === taskId);
  if (current === undefined) return null;
  for (const other of tasks) {
    if (other.id === taskId || !heldIds.has(other.id)) continue;
    for (const left of current.files) {
      for (const right of other.files) {
        if (pathsOverlap(left, right)) return other.id;
      }
    }
  }
  return null;
}
