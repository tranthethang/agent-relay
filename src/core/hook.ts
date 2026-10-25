import { mkdir, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { rebuildRun } from "./cache.js";
import { findRelayDir, listRunNames } from "./discover.js";
import { RelayError } from "./error.js";
import { atomicWrite, isEnoent } from "./files.js";
import { gitRoot } from "./git.js";
import { guardPath } from "./guard.js";
import { readPolicy } from "./policy.js";
import { schemaVersion } from "./vocab.js";
import { gitCwd, runGitCwd } from "./worktree.js";

export const hookCommand = "atry hook check";
export const hookMatcher = "Edit|MultiEdit|Write|NotebookEdit";
const settingsRel = ".claude/settings.json";

export type HookInstallResult = {
  schema: 1;
  path: string;
  status: "added" | "present";
};

export type HookDecision = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse";
    permissionDecision: "ask" | "deny";
    permissionDecisionReason: string;
  };
};

type Settings = Record<string, unknown>;

export function hookInstallText(result: HookInstallResult): string {
  return `path: ${result.path}\nhook: ${result.status}\n`;
}

// Project settings only; a user-level settings file is outside this repo.
export async function installHook(cwd: string, tool: string): Promise<HookInstallResult> {
  if (tool !== "claude-code") {
    throw new RelayError("usage", "hook install supports only claude-code", "tool");
  }
  const path = join(await gitRoot(cwd), ".claude", "settings.json");
  const settings = await readSettings(path);
  const hooks = objectField(settings.hooks, "hooks");
  const preToolUse = arrayField(hooks.PreToolUse, "hooks.PreToolUse");
  if (preToolUse.some(runsHookCommand)) {
    return { schema: schemaVersion, path, status: "present" };
  }
  preToolUse.push({ matcher: hookMatcher, hooks: [{ type: "command", command: hookCommand }] });
  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;
  await mkdir(dirname(path), { recursive: true });
  await atomicWrite(path, `${JSON.stringify(settings, null, 2)}\n`);
  return { schema: schemaVersion, path, status: "added" };
}

// Returns null when the edit may go ahead without a question.
export async function hookCheck(inputText: string): Promise<HookDecision | null> {
  const input = parseHookInput(inputText);
  if (input.path === undefined) return null;
  let relayDir: string;
  try {
    relayDir = await findRelayDir(input.cwd);
  } catch (error) {
    if (error instanceof RelayError && error.code === "not_found") return null;
    throw error;
  }
  const outside: { name: string; strict: boolean }[] = [];
  for (const name of await listRunNames(relayDir)) {
    const runDir = join(relayDir, name);
    const loaded = await rebuildRun(runDir);
    if (loaded.run.state.lifecycle !== "implementing") continue;
    const root = await gitRoot(await gitCwd(runDir));
    if (!(await underRoot(root, input.path))) continue;
    if ((await guardPath(runDir, input.path)).allowed) return null;
    const policy = await readPolicy(await runGitCwd(runDir, loaded.run), loaded.run.base);
    outside.push({ name, strict: policy.strict.scope });
  }
  if (outside.length === 0) return null;
  const names = outside.map((run) => run.name).join(", ");
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: outside.some((run) => run.strict) ? "deny" : "ask",
      permissionDecisionReason: `${input.path} is outside the in-progress task files of ${names}. `
        + "Start the task that lists this file, or amend the plan.",
    },
  };
}

// A path outside the root, or the root itself, is not under it.
async function underRoot(root: string, path: string): Promise<boolean> {
  const rel = relative(await realpath(root), await realExisting(path));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

// Real path of the nearest existing ancestor, with the missing tail joined back.
async function realExisting(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!isEnoent(error)) throw error;
    return join(await realExisting(dirname(path)), basename(path));
  }
}

function parseHookInput(text: string): { cwd: string; path?: string } {
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new RelayError("validation", "hook input must be an object");
  const cwd = typeof value.cwd === "string" ? value.cwd : process.cwd();
  const toolInput = isRecord(value.tool_input) ? value.tool_input : {};
  const raw = stringField(toolInput.file_path) ?? stringField(toolInput.notebook_path);
  if (raw === undefined) return { cwd };
  return { cwd, path: isAbsolute(raw) ? raw : resolve(cwd, raw) };
}

async function readSettings(path: string): Promise<Settings> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return {};
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new RelayError("validation", "invalid JSON", settingsRel);
  }
  if (!isRecord(value)) {
    throw new RelayError("validation", "settings must be an object", settingsRel);
  }
  return value;
}

function objectField(value: unknown, field: string): Settings {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new RelayError("validation", "must be an object", `${settingsRel}:${field}`);
  }
  return value;
}

function arrayField(value: unknown, field: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new RelayError("validation", "must be an array", `${settingsRel}:${field}`);
  }
  return value as unknown[];
}

function runsHookCommand(entry: unknown): boolean {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook: unknown) => isRecord(hook) && hook.command === hookCommand);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
