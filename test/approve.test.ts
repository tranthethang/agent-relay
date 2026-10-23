import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo, writeReadyPlan } from "./helper.js";
import { createRun } from "./plan-helper.js";

async function events(run: string): Promise<string> {
  return readFile(join(run, "events.jsonl"), "utf8");
}

test("atry approve records via and marks the run approved", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "approve-run");
    await writeReadyPlan(run);
    const approved = await runCli(["approve", run, "--via", "confirm", "--json"], dir);
    expect(approved.code, approved.stderr).toBe(0);
    expect(JSON.parse(approved.stdout)).toMatchObject({ approved: true, lifecycle: "approved" });
    const lines = (await events(run)).trim().split("\n");
    const event = JSON.parse(lines[lines.length - 1] ?? "") as {
      action: string;
      actor?: string;
      via: string;
    };
    expect(event).toMatchObject({ stage: "plan", action: "approved", via: "confirm" });
    expect(["agent-env", "unknown"]).toContain(event.actor);
    const bad = await runCli(["approve", run, "--via", "chat"], dir);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("via:");
  });
});

test("approve refuses a missing plan without recording an event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "approve-empty");
    const before = await events(run);
    const refused = await runCli(["approve", run, "--via", "arg"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("approve refused: plan is not ready");
    expect(refused.stderr).toContain("10-plan/index.json");
    expect(await events(run)).toBe(before);
  });
});

test("approve refuses an empty task file without recording an event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "approve-thin");
    await writeReadyPlan(run);
    await writeFile(join(run, "10-plan", "T1.md"), "# T1: One\n\n## Detail\n\nOnly detail.\n");
    const before = await events(run);
    const refused = await runCli(["approve", run, "--via", "arg"], dir);
    expect(refused.code).toBe(4);
    expect(refused.stderr).toContain("10-plan/T1.md: Acceptance");
    expect(await events(run)).toBe(before);
  });
});

test("approve --preview shows every plan section and each task file", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "preview-approve");
    await writeReadyPlan(run);
    await writeFile(
      join(run, "10-plan/overview.md"),
      "# Overview\n\n## Goal\n\nShip the preview.\n\n## Non-goals\n\nNo extra scope.\n\n## Constraints\n\nKeep the headings exact.\n\n## Decisions\n\n- Use one task.\n",
    );
    await writeFile(
      join(run, "10-plan/T1.md"),
      "# T1: One\n\n## Detail\n\nDo the one task.\n\n## Acceptance\n\n- It works.\n",
    );
    const before = await events(run);

    const text = await runCli(["approve", run, "--preview"], dir);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("Goal:\nShip the preview.");
    expect(text.stdout).toContain("Non-goals:\nNo extra scope.");
    expect(text.stdout).toContain("Constraints:\nKeep the headings exact.");
    expect(text.stdout).toContain("Decisions:\n- Use one task.");
    expect(text.stdout).toContain("tasks: 1");
    expect(text.stdout).toContain("- T1: One");
    expect(text.stdout).toContain("ready: yes");
    expect(await events(run)).toBe(before);

    const json = await runCli(["approve", run, "--preview", "--json"], dir);
    expect(json.code, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      schema: 1,
      goal: "Ship the preview.",
      nonGoals: "No extra scope.",
      constraints: "Keep the headings exact.",
      decisions: "- Use one task.",
      tasks: 1,
      taskFiles: [
        {
          id: "T1",
          title: "One",
          files: ["src/one.ts"],
          detail: "Do the one task.",
          acceptance: "- It works.",
          detailOk: true,
          acceptanceOk: true,
        },
      ],
      ready: true,
      missing: [],
    });
    expect(await events(run)).toBe(before);
  });
});

test("approve --preview reports gaps without throwing", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "preview-gaps");
    await mkdir(join(run, "10-plan"), { recursive: true });
    await writeFile(join(run, "10-plan/overview.md"), "# Overview\n\n## Goal\n\n\n");
    await writeFile(
      join(run, "10-plan/index.json"),
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{ id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" }],
        })
      }\n`,
    );
    await writeFile(join(run, "10-plan/T1.md"), "# T1: One\n\n## Detail\n\nOnly detail.\n");

    const preview = await runCli(["approve", run, "--preview", "--json"], dir);
    expect(preview.code, preview.stderr).toBe(0);
    const body = JSON.parse(preview.stdout) as {
      ready: boolean;
      missing: string[];
      taskFiles: { detailOk: boolean; acceptanceOk: boolean }[];
    };
    expect(body.ready).toBe(false);
    expect(body.missing).toEqual([
      "10-plan/overview.md",
      "10-plan/T1.md: Acceptance",
    ]);
    expect(body.taskFiles[0]).toMatchObject({ detailOk: true, acceptanceOk: false });
  });
});
