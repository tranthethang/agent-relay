import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { gitCommit, reachReview, runCli, withTempGitRepo } from "./helper.js";

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
