import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { rebuildRun } from "./cache.js";
import { exitCodes } from "./error.js";
import { readJson } from "./files.js";
import { gitRoot } from "./git.js";
import { normalizePath, pathsOverlap } from "./overlap.js";
import { type PlanIndex, planIndexSchema } from "./tasks.js";
import { schemaVersion } from "./vocab.js";
import { gitCwd } from "./worktree.js";

const runRoot = ".agent-relay";

export type GuardResult = {
  schema: 1;
  allowed: boolean;
  task: string | null;
};

export function guardText(result: GuardResult): string {
  const lines = [`allowed: ${result.allowed ? "yes" : "no"}`];
  if (result.task !== null) lines.push(`task: ${result.task}`);
  return `${lines.join("\n")}\n`;
}

export async function guardPath(
  runDir: string,
  inputPath: string,
  session?: string,
): Promise<GuardResult> {
  const root = await gitRoot(await gitCwd(runDir));
  const relativePath = repoRelative(root, inputPath);
  if (relativePath === null) return { schema: schemaVersion, allowed: false, task: null };
  if (relativePath === runRoot || relativePath.startsWith(`${runRoot}/`)) {
    return { schema: schemaVersion, allowed: true, task: null };
  }
  const loaded = await rebuildRun(runDir);
  const index = planIndexSchema.parse(await readJson(join(runDir, "10-plan", "index.json")));
  const task = coveringTask(index, loaded.run.state.tasks, relativePath, session);
  if (task === null) return { schema: schemaVersion, allowed: false, task: null };
  return { schema: schemaVersion, allowed: true, task };
}

export function guardExit(result: GuardResult): number {
  return result.allowed ? exitCodes.ok : exitCodes.gate;
}

function repoRelative(root: string, inputPath: string): string | null {
  const slashed = inputPath.replaceAll("\\", "/");
  const absolute = resolve(slashed);
  const rel = relative(root, absolute);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) return null;
  try {
    return normalizePath(rel.split(sep).join("/"));
  } catch {
    return null;
  }
}

function coveringTask(
  index: PlanIndex,
  tasks: readonly { id: string; status: string; session?: string }[],
  path: string,
  session: string | undefined,
): string | null {
  for (const item of index.tasks) {
    const state = tasks.find((task) => task.id === item.id);
    if (state?.status !== "in-progress") continue;
    if (session !== undefined && state.session !== session) continue;
    if (item.files.some((file) => pathsOverlap(path, file))) return item.id;
  }
  return null;
}
