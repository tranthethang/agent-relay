import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";

test("atry approve records via and marks the run approved", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "approve-run",
      "--title",
      "Approve",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string; id: string };
    const approved = await runCli(["--run", run.id, "approve", "--via", "confirm", "--json"], dir);
    expect(approved.code).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({ approved: true, lifecycle: "approved" });
    const lines = (await readFile(join(run.path, "events.jsonl"), "utf8")).trim().split("\n");
    const event = JSON.parse(lines[lines.length - 1] ?? "") as {
      action: string;
      actor?: string;
      via: string;
    };
    expect(event).toMatchObject({ stage: "plan", action: "approved", via: "confirm" });
    expect(["agent-env", "unknown"]).toContain(event.actor);
    const bad = await runCli(["approve", run.path, "--via", "chat"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("via:");
  });
});

test("approve --preview prints Goal, Decisions, and the task count", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "preview-approve",
      "--title",
      "Preview",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    await writeFile(
      join(run.path, "10-plan/overview.md"),
      "# Overview\n\n## Goal\n\nShip the preview.\n\n## Decisions\n\n- Keep the headings exact.\n\n## Constraints\n\nSkip this.\n",
    );
    await writeFile(
      join(run.path, "10-plan/index.json"),
      `${
        JSON.stringify({
          schema: 1,
          tasks: [
            { id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" },
            { id: "T2", title: "Two", deps: ["T1"], files: ["src/a.ts"], path: "10-plan/T2.md" },
          ],
        })
      }\n`,
    );
    const before = await readFile(join(run.path, "events.jsonl"), "utf8");
    const text = await runCli(["approve", run.path, "--preview"], dir);
    expect(text.code).toBe(0);
    expect(text.stdout).toBe(
      "Goal:\nShip the preview.\n\nDecisions:\n- Keep the headings exact.\n\ntasks: 2\n",
    );
    const json = await runCli(["approve", run.path, "--preview", "--json"], dir);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      schema: 1,
      goal: "Ship the preview.",
      decisions: "- Keep the headings exact.",
      tasks: 2,
    });
    expect(await readFile(join(run.path, "events.jsonl"), "utf8")).toBe(before);

    await writeFile(join(run.path, "10-plan/overview.md"), "## Decisions\n\nOnly this heading.\n");
    const missing = await runCli(["approve", run.path, "--preview", "--json"], dir);
    expect(missing.code).toBe(0);
    expect(JSON.parse(missing.stdout)).toMatchObject({ goal: "", decisions: "Only this heading." });
  });
});
