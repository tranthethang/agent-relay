import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";
import { createRun, writeTasks } from "./plan-helper.js";

const execFileAsync = promisify(execFile);

test("atry stage start and done record tool, model, head, and size", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "stage-fields",
      "--title",
      "Stages",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    const started = await runCli([
      "stage",
      "start",
      run.path,
      "plan",
      "--tool",
      "cursor",
      "--model",
      "unknown",
      "--json",
    ], dir);
    expect(started.code).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({
      stage: "plan",
      action: "started",
      lifecycle: "planned",
    });
    expect(JSON.parse(started.stdout)).not.toHaveProperty("head");
    const planDone = await runCli(["stage", "done", run.path, "plan", "--tool", "cursor"], dir);
    expect(planDone.code).toBe(0);
    expect(planDone.stdout).not.toContain("head:");
    await runCli(["approve", run.path, "--via", "arg"], dir);
    const implement = await runCli([
      "stage",
      "start",
      run.path,
      "implement",
      "--tool",
      "cursor",
      "--json",
    ], dir);
    expect(JSON.parse(implement.stdout)).toMatchObject({ lifecycle: "implementing" });
    await writeFile(join(dir, "note.txt"), "hello\n");
    await execFileAsync("git", ["add", "note.txt"], { cwd: dir });
    await gitCommit(dir, "add note");
    const done = await runCli([
      "stage",
      "done",
      run.path,
      "implement",
      "--tool",
      "cursor",
      "--model",
      "unknown",
      "--allow-extra",
      "tracked note",
      "--json",
    ], dir);
    expect(done.code).toBe(0);
    const body = JSON.parse(done.stdout) as {
      head: string;
      size: { files: number; added: number; deleted: number };
      lifecycle: string;
    };
    expect(body.lifecycle).toBe("reviewing");
    expect(body.head).toMatch(/^[0-9a-f]{40}$/);
    expect(body.size.files).toBe(1);
    expect(body.size.added).toBeGreaterThan(0);
    const bad = await runCli(["stage", "start", run.path, "implement", "--tool", "claude"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("tool:");
  });
});

test("implement done refuses a file edited after the last task done", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const clean = await createRun(dir, "clean-scope");
    expect((await runCli(["approve", clean, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", clean, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["stage", "done", clean, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);

    const run = await createRun(dir, "late-edit");
    await writeTasks(run, [{ title: "Kept", files: ["src/kept.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    expect((await runCli(["approve", run, "--via", "arg"], dir)).code).toBe(0);
    expect((await runCli(["stage", "start", run, "implement", "--tool", "cursor"], dir)).code)
      .toBe(0);
    expect((await runCli(["task", "start", run, "T1"], dir)).code).toBe(0);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/kept.ts"), "export const kept = 1;\n");
    expect((await runCli(["task", "done", run, "T1"], dir)).code).toBe(0);
    await writeFile(join(dir, "src/later.ts"), "export const later = 1;\n");
    const refused = await runCli(["stage", "done", run, "implement", "--tool", "cursor"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("src/later.ts");
    const allowed = await runCli([
      "stage",
      "done",
      run,
      "implement",
      "--tool",
      "cursor",
      "--allow-extra",
      "late note",
      "--json",
    ], dir);
    expect(allowed.code).toBe(0);
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    const completed = events.trim().split("\n").map((line) =>
      JSON.parse(line) as {
        action: string;
        stage: string;
        extra?: string[];
        reason?: string;
      }
    ).find((event) => event.action === "completed" && event.stage === "implement");
    expect(completed?.reason).toBe("late note");
    expect(completed?.extra).toEqual(["src/later.ts"]);
  });
});

test("atry stage done measures the repo that holds the run", async () => {
  await withTempGitRepo(async (owner) => {
    await gitCommit(owner);
    const created = await runCli(
      ["run", "new", "--slug", "owner", "--title", "Owner", "--json"],
      owner,
    );
    const run = JSON.parse(created.stdout) as { path: string; base: string };
    await withTempGitRepo(async (other) => {
      await gitCommit(other, "other");
      await runCli(["run", "new", "--slug", "other", "--title", "Other"], other);
      await reachReview(run.path, other);
      const review = await runCli([
        "stage",
        "done",
        run.path,
        "self-review",
        "--tool",
        "cursor",
        "--json",
      ], other);
      expect(review.code).toBe(0);
      expect(JSON.parse(review.stdout)).toMatchObject({
        head: run.base,
        size: { files: 0, added: 0, deleted: 0 },
      });
    });
  });
});
