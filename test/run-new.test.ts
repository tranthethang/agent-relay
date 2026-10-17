import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createRun } from "../src/core/scaffold.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";

test("atry run new writes the run cache, event, and stage folders", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "next-run-lifecycle",
      "--title",
      "v2 P4",
      "--json",
    ], dir);
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as { path: string; id: string; base: string };
    expect(body.id).toMatch(/^[0-9]{10,11}$/);
    const run = JSON.parse(await readFile(join(body.path, "run.json"), "utf8")) as {
      title: string;
      base: string;
      state: { lifecycle: string; stage: string; approved: boolean };
    };
    expect(run.title).toBe("v2 P4");
    expect(run.base).toBe(body.base);
    expect(run.state).toEqual({
      lifecycle: "planned",
      stage: "plan",
      approved: false,
      tasks: [],
    });
    const event = JSON.parse(
      (await readFile(join(body.path, "events.jsonl"), "utf8")).trim(),
    ) as { stage: string; action: string };
    expect(event).toMatchObject({ stage: "run", action: "created" });
    for (const folder of ["10-plan", "20-implement", "30-self-review", "40-cross-review"]) {
      expect((await stat(join(body.path, folder))).isDirectory()).toBe(true);
    }
    const status = await runCli(["status", "--json", body.path], dir);
    expect(status.code).toBe(0);
    expect(JSON.parse(status.stdout)).toMatchObject({ lifecycle: "planned", approved: false });
  });
});

test("atry run new links --from and skips a taken id", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const nowMs = Date.UTC(2026, 9, 17, 0, 0, 0);
    const first = await createRun({
      cwd: dir,
      slug: "alpha-run",
      title: "First",
      nowMs,
    });
    await mkdir(join(dir, ".agent-relay", "brainstorms", "20261017-agent-relay-v2"), {
      recursive: true,
    });
    const second = await createRun({
      cwd: dir,
      slug: "beta-run",
      title: "Second",
      from: "brainstorms/20261017-agent-relay-v2",
      nowMs,
    });
    expect(second.id).toBe(String(Number(first.id) + 1));
    expect(second.from).toBe("brainstorms/20261017-agent-relay-v2");
    const event = JSON.parse(
      (await readFile(join(second.path, "events.jsonl"), "utf8")).trim(),
    ) as { ref?: string };
    expect(event.ref).toBe(second.from);
    const missing = await runCli([
      "run",
      "new",
      "--slug",
      "gamma-run",
      "--title",
      "Third",
      "--from",
      "brainstorms/20261017-missing-topic",
    ], dir);
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain("from:");
  });
});

test("atry run new rejects an empty title", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const result = await runCli(
      ["run", "new", "--slug", "next-run-lifecycle", "--title", " "],
      dir,
    );
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("title:");
  });
});
