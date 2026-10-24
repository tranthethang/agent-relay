import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { afterEach, expect, test, vi } from "vitest";
import { runHookCheck } from "../src/cli/hook.js";
import { findRelayDir } from "../src/core/discover.js";
import { hookCheck, hookCommand, hookMatcher, installHook } from "../src/core/hook.js";
import { cliPath, gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, readFile: vi.fn(real.readFile) };
});

vi.mock("../src/core/discover.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/core/discover.js")>();
  return { ...real, findRelayDir: vi.fn(real.findRelayDir) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

function hookInput(cwd: string, toolInput: Record<string, unknown>): string {
  return JSON.stringify({ cwd, tool_name: "Edit", tool_input: toolInput });
}

function runHookCli(input: string, cwd: string): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "hook", "check"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code: code ?? 1 }));
    child.stdin.end(input);
  });
}

async function implementingRun(dir: string, slug: string, policy?: object): Promise<string> {
  if (policy !== undefined) {
    await writeFile(join(dir, ".agent-relay.json"), JSON.stringify(policy));
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
  }
  await gitCommit(dir);
  const run = await createRun(dir, slug);
  await writeTasks(run, [
    { title: "Own", files: ["src/own.ts"] },
    { title: "Later", files: ["src/later.ts"] },
  ]);
  expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
  await startImplement(dir, run);
  expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
  return run;
}

test("hook install adds one PreToolUse entry and keeps other settings", async () => {
  await withTempGitRepo(async (dir) => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { allow: ["Bash(ls)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "x" }] }] },
      }),
    );
    const first = await runCli(["hook", "install", "--tool", "claude-code", "--json"], dir);
    expect(first.code).toBe(0);
    expect(JSON.parse(first.stdout)).toMatchObject({ schema: 1, status: "added" });
    const second = await runCli(["hook", "install", "--tool", "claude-code"], dir);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain("hook: present");
    const settings = JSON.parse(await readFile(join(dir, ".claude", "settings.json"), "utf8")) as {
      permissions: unknown;
      hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] };
    };
    expect(settings.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[1]).toEqual({
      matcher: hookMatcher,
      hooks: [{ type: "command", command: hookCommand }],
    });
  });
});

test("hook install creates the settings file when it is missing", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await installHook(dir, "claude-code");
    expect(result.status).toBe("added");
    const settings = JSON.parse(await readFile(result.path, "utf8")) as unknown;
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [{ matcher: hookMatcher, hooks: [{ type: "command", command: hookCommand }] }],
      },
    });
  });
});

test("hook install refuses an unknown tool and bad settings", async () => {
  await withTempGitRepo(async (dir) => {
    const tool = await runCli(["hook", "install", "--tool", "cursor"], dir);
    expect(tool.code).toBe(1);
    expect(tool.stderr).toContain("hook install supports only claude-code");

    const path = join(dir, ".claude", "settings.json");
    await mkdir(join(dir, ".claude"), { recursive: true });
    const cases: [string, string][] = [
      ["{", ".claude/settings.json: invalid JSON"],
      ["[]", ".claude/settings.json: settings must be an object"],
      ["{\"hooks\":[]}", ".claude/settings.json:hooks: must be an object"],
      [
        "{\"hooks\":{\"PreToolUse\":{}}}",
        ".claude/settings.json:hooks.PreToolUse: must be an array",
      ],
    ];
    for (const [text, message] of cases) {
      await writeFile(path, text);
      const result = await runCli(["hook", "install", "--tool", "claude-code"], dir);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(message);
      expect(await readFile(path, "utf8")).toBe(text);
    }
  });
});

test("hook install treats other PreToolUse entries as different hooks", async () => {
  await withTempGitRepo(async (dir) => {
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ hooks: { PreToolUse: ["text", { matcher: "Edit" }, { hooks: ["text"] }] } }),
    );
    expect((await installHook(dir, "claude-code")).status).toBe("added");
  });
});

test("hook check allows edits without a path, a relay folder, or an implementing run", async () => {
  await withTempDir(async (dir) => {
    expect(await hookCheck(JSON.stringify({ cwd: dir, tool_input: {} }))).toBeNull();
    expect(await hookCheck(JSON.stringify({ cwd: dir }))).toBeNull();
    expect(await hookCheck(hookInput(dir, { file_path: join(dir, "a.ts") }))).toBeNull();
  });
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    await createRun(dir, "hook-planned");
    expect(await hookCheck(hookInput(dir, { file_path: join(dir, "a.ts") }))).toBeNull();
  });
});

test("hook check allows task files and run files and asks for other paths", async () => {
  await withTempGitRepo(async (dir) => {
    const run = await implementingRun(dir, "hook-ask");
    expect(await hookCheck(hookInput(dir, { file_path: join(dir, "src", "own.ts") }))).toBeNull();
    expect(await hookCheck(hookInput(dir, { file_path: "src/own.ts" }))).toBeNull();
    expect(await hookCheck(hookInput(dir, { file_path: join(run, "20-implement", "T1.md") })))
      .toBeNull();
    const decision = await hookCheck(hookInput(dir, { notebook_path: "src/later.ts" }));
    expect(decision?.hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
    });
    expect(decision?.hookSpecificOutput.permissionDecisionReason).toContain("hook-ask");
  });
});

test("hook check denies other paths when strict scope is on", async () => {
  await withTempGitRepo(async (dir) => {
    await implementingRun(dir, "hook-deny", {
      schema: 1,
      requireReviews: ["self"],
      smallChange: 20,
      strict: { scope: true, plan: false, reviewIntegrity: false },
    });
    const result = await runHookCli(hookInput(dir, { file_path: join(dir, "README.md") }), dir);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
    const allowed = await runHookCli(hookInput(dir, { file_path: join(dir, "src/own.ts") }), dir);
    expect(allowed).toEqual({ stdout: "", code: 0 });
  });
});

test("hook check ignores a path outside the git root of an implementing run", async () => {
  await withTempGitRepo(async (dir) => {
    await implementingRun(dir, "hook-outside", {
      schema: 1,
      requireReviews: ["self"],
      smallChange: 20,
      strict: { scope: true, plan: false, reviewIntegrity: false },
    });
    await withTempDir(async (other) => {
      const outside = await runHookCli(hookInput(dir, { file_path: join(other, "a.ts") }), dir);
      expect(outside).toEqual({ stdout: "", code: 0 });
    });
    expect(await hookCheck(hookInput(dir, { file_path: dir }))).toBeNull();
    const inside = await runHookCli(hookInput(dir, { file_path: join(dir, "README.md") }), dir);
    expect(JSON.parse(inside.stdout)).toMatchObject({
      hookSpecificOutput: { permissionDecision: "deny" },
    });
  });
});

test("hook check still checks a new file in a missing dir and a symlinked prefix", async () => {
  await withTempGitRepo(async (dir) => {
    await implementingRun(dir, "hook-new");
    const fresh = await hookCheck(hookInput(dir, { file_path: join(dir, "new", "deep", "a.ts") }));
    expect(fresh?.hookSpecificOutput.permissionDecision).toBe("ask");
    await withTempDir(async (other) => {
      const link = join(other, "link");
      await symlink(dir, link, "dir");
      const linked = await hookCheck(hookInput(dir, { file_path: join(link, "README.md") }));
      expect(linked?.hookSpecificOutput.permissionDecision).toBe("ask");
    });
  });
});

test("hook check prints nothing when the input or a run is broken", async () => {
  await withTempGitRepo(async (dir) => {
    expect(await runHookCli("not json", dir)).toEqual({ stdout: "", code: 0 });
    await expect(hookCheck("[]")).rejects.toThrow("hook input must be an object");
    const run = await implementingRun(dir, "hook-broken");
    await writeFile(join(run, "events.jsonl"), "{\n");
    const input = hookInput(dir, { file_path: join(dir, "README.md") });
    await expect(hookCheck(input)).rejects.toThrow();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await runHookCheck(Readable.from([input]));
    expect(write).not.toHaveBeenCalled();
  });
});

test("runHookCheck reads string and Buffer chunks", async () => {
  await withTempGitRepo(async (dir) => {
    await implementingRun(dir, "hook-chunks");
    const input = hookInput(dir, { file_path: join(dir, "README.md") });
    const written: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    await runHookCheck(Readable.from([input.slice(0, 10), Buffer.from(input.slice(10))]));
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0] ?? "")).toMatchObject({
      hookSpecificOutput: { permissionDecision: "ask" },
    });
  });
});

test("hook check allows an edit when no relay folder is found above the cwd", async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, ".agent-relay"), "a file, not a folder\n");
    await mkdir(join(dir, "child"));
    const input = hookInput(join(dir, "child"), { file_path: "a.ts" });
    await expect(hookCheck(input)).resolves.toBeNull();
  });
});

test("hook check and hook install rethrow unexpected errors", async () => {
  await withTempGitRepo(async (dir) => {
    vi.mocked(findRelayDir).mockRejectedValueOnce(new Error("disk failed"));
    await expect(hookCheck(hookInput(dir, { file_path: "a.ts" }))).rejects.toThrow("disk failed");
    const denied = Object.assign(new Error("denied"), { code: "EACCES" });
    vi.mocked(readFile).mockRejectedValueOnce(denied);
    await expect(installHook(dir, "claude-code")).rejects.toThrow("denied");
  });
});

test("installHook names each invalid settings field in process", async () => {
  await withTempGitRepo(async (dir) => {
    const path = join(dir, ".claude", "settings.json");
    await mkdir(join(dir, ".claude"), { recursive: true });
    const cases: [string, string][] = [
      ["{", "invalid JSON"],
      ["null", "settings must be an object"],
      ["{\"hooks\":1}", "must be an object"],
      ["{\"hooks\":{\"PreToolUse\":1}}", "must be an array"],
    ];
    for (const [text, message] of cases) {
      await writeFile(path, text);
      await expect(installHook(dir, "claude-code")).rejects.toThrow(message);
    }
    await expect(installHook(dir, "codex")).rejects.toThrow("supports only claude-code");
  });
});
