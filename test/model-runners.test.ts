import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createRunners } from "../evals/model/runners.js";
import { withTempGitRepo } from "./helper.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// A fake binary that records its argv, cwd, and the `atry` it resolves, then runs `body`.
async function fakeBin(name: string, body = ""): Promise<{ bin: string; log: string }> {
  const bin = await mkdtemp(join(tmpdir(), "atry-fake-"));
  cleanups.push(bin);
  const log = join(bin, "log.json");
  await writeFile(
    join(bin, name),
    `#!/usr/bin/env node
const { writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
let atry = "";
try { atry = execFileSync("atry", ["version"], { encoding: "utf8" }).trim(); } catch (e) { atry = "ERR " + e.message; }
writeFileSync(${
      JSON.stringify(log)
    }, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), atry }));
${body}
`,
  );
  await chmod(join(bin, name), 0o755);
  return { bin, log };
}

function envWith(bin: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
    ANTHROPIC_API_KEY: "k",
    OPENAI_API_KEY: "k",
    ...extra,
  };
}

function runner(tool: string, env: NodeJS.ProcessEnv) {
  const found = createRunners({ env, maxTurns: 7 }).find((r) => r.tool === tool);
  if (!found) throw new Error(`no runner ${tool}`);
  return found;
}

test("claude-code runs claude -p with the turn cap, allowed tools, cwd, and skills installed", async () => {
  const { bin, log } = await fakeBin("claude");
  await withTempGitRepo(async (repo) => {
    const result = await runner("claude-code", envWith(bin)).run("do it", repo, 20_000);
    expect(result).toMatchObject({ exit: 0, timedOut: false });
    const seen = JSON.parse(await readFile(log, "utf8"));
    expect(seen.argv.slice(0, 4)).toEqual(["-p", "do it", "--max-turns", "7"]);
    expect(seen.argv).toContain("--allowedTools");
    expect(seen.argv).toContain("Bash(atry:*)");
    expect(seen.cwd).toBe(await (await import("node:fs/promises")).realpath(repo));
    expect(seen.atry).not.toMatch(/^ERR/);
    const skill = await readFile(join(repo, ".claude", "skills", "atry-plan", "SKILL.md"), "utf8");
    expect(skill).toContain("atry");
    expect(await readFile(join(repo, ".git", "info", "exclude"), "utf8")).toContain(
      "/.claude/skills/",
    );
  });
});

test("codex runs codex exec in the workspace-write sandbox with skills under .agents", async () => {
  const { bin, log } = await fakeBin("codex");
  await withTempGitRepo(async (repo) => {
    await runner("codex", envWith(bin)).run("go", repo, 20_000);
    const seen = JSON.parse(await readFile(log, "utf8"));
    expect(seen.argv).toEqual([
      "exec",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
      "go",
    ]);
    await readFile(join(repo, ".agents", "skills", "atry-plan", "SKILL.md"), "utf8");
  });
});

test("a child that outlives the timeout is killed and reported", async () => {
  const { bin } = await fakeBin("claude", "setTimeout(() => {}, 60000);");
  await withTempGitRepo(async (repo) => {
    const result = await runner("claude-code", envWith(bin)).run("slow", repo, 1500);
    expect(result.timedOut).toBe(true);
    expect(result.exit).toBeNull();
    expect(result.ms).toBeLessThan(15_000);
  });
});

test("a non-zero exit is reported", async () => {
  const { bin } = await fakeBin("codex", "process.exit(3);");
  await withTempGitRepo(async (repo) => {
    const result = await runner("codex", envWith(bin)).run("x", repo, 20_000);
    expect(result).toMatchObject({ exit: 3, timedOut: false });
  });
});

test("a failed skills install rejects", async () => {
  const { bin } = await fakeBin("claude");
  const missing = join(tmpdir(), "atry-no-such-repo", "x");
  await expect(runner("claude-code", envWith(bin)).run("x", missing, 5000)).rejects.toThrow();
});

test("available() needs the binary on PATH and a non-empty key", async () => {
  const { bin } = await fakeBin("claude");
  const empty = await mkdtemp(join(tmpdir(), "atry-empty-"));
  cleanups.push(empty);
  await mkdir(join(empty, "sub"));
  expect(runner("claude-code", envWith(bin)).available()).toBe(true);
  expect(runner("claude-code", envWith(bin, { ANTHROPIC_API_KEY: "" })).available()).toBe(false);
  expect(runner("claude-code", { PATH: empty, ANTHROPIC_API_KEY: "k" }).available()).toBe(false);
  expect(runner("codex", { PATH: `${empty}${delimiter}`, OPENAI_API_KEY: "k" }).available()).toBe(
    false,
  );
  expect(runner("codex", { OPENAI_API_KEY: "k" }).available()).toBe(false);
});
