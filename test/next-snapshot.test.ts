import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type EventLine } from "../src/core/event.js";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { plannedState, runCache, seedRelay, seedRun } from "./seed.js";

function ev(stage: EventLine["stage"], action: EventLine["action"]): EventLine {
  return { schema: 1, ts: "2026-10-17T00:00:00.000Z", stage, action };
}

test("atry next --json snapshots each lifecycle", async () => {
  const cases: { lifecycle: string; events: EventLine[]; command: string }[] = [
    {
      lifecycle: "planned",
      events: [ev("run", "created")],
      command: "atry approve",
    },
    {
      lifecycle: "approved",
      events: [ev("run", "created"), ev("plan", "approved")],
      command: "atry stage start",
    },
    {
      lifecycle: "implementing",
      events: [
        ev("run", "created"),
        ev("plan", "approved"),
        ev("implement", "started"),
        { ...ev("implement", "task-started"), task: "T1" },
      ],
      command: "atry list",
    },
    {
      lifecycle: "reviewing",
      events: [
        ev("run", "created"),
        ev("plan", "approved"),
        ev("implement", "started"),
        ev("implement", "completed"),
      ],
      command: "atry review new",
    },
    {
      lifecycle: "closed",
      events: [ev("run", "created"), ev("run", "closed")],
      command: "none",
    },
    {
      lifecycle: "abandoned",
      events: [ev("run", "created"), ev("run", "abandoned")],
      command: "none",
    },
  ];

  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    const bodies = [];
    for (const [index, item] of cases.entries()) {
      const id = `17922087${String(index).padStart(2, "0")}`;
      const name = `20261017-${id}-${item.lifecycle}-snap`;
      await seedRun(relay, name, {
        ...(runCache(plannedState) as { id: string; slug: string }),
        id,
        slug: `${item.lifecycle}-snap`,
      }, item.events);
      const result = await runCli(["next", "--json", name], root);
      expect(result.code, result.stderr).toBe(0);
      const body = JSON.parse(result.stdout) as { command: string };
      expect(body.command.startsWith(item.command) || body.command === item.command).toBe(true);
      bodies.push(body);
    }
    expect(bodies).toMatchInlineSnapshot(`
      [
        {
          "actions": [
            {
              "command": "atry approve 1792208700",
              "needsHuman": true,
              "read": [
                "10-plan/overview.md",
              ],
              "reason": "The plan is waiting for approval.",
            },
          ],
          "command": "atry approve 1792208700",
          "needsHuman": true,
          "read": [
            "10-plan/overview.md",
          ],
          "reason": "The plan is waiting for approval.",
          "recommendation": "atry approve 1792208700",
          "schema": 1,
          "state": {
            "approved": false,
            "lifecycle": "planned",
            "stage": "plan",
          },
        },
        {
          "actions": [
            {
              "command": "atry stage start 1792208701 implement",
              "needsHuman": false,
              "read": [],
              "reason": "Implement has not started.",
            },
          ],
          "command": "atry stage start 1792208701 implement",
          "needsHuman": false,
          "read": [],
          "reason": "Implement has not started.",
          "recommendation": "atry stage start 1792208701 implement",
          "schema": 1,
          "state": {
            "approved": true,
            "lifecycle": "approved",
            "stage": "plan",
          },
        },
        {
          "actions": [
            {
              "command": "atry list 1792208702",
              "needsHuman": false,
              "read": [],
              "reason": "The next command comes from the run state.",
            },
          ],
          "command": "atry list 1792208702",
          "needsHuman": false,
          "read": [],
          "reason": "The next command comes from the run state.",
          "recommendation": "atry list 1792208702",
          "schema": 1,
          "state": {
            "approved": true,
            "lifecycle": "implementing",
            "stage": "implement",
          },
        },
        {
          "actions": [
            {
              "command": "atry review new 1792208703 self",
              "needsHuman": false,
              "read": [],
              "reason": "Self-review has not started.",
            },
          ],
          "command": "atry review new 1792208703 self",
          "needsHuman": false,
          "read": [],
          "reason": "Self-review has not started.",
          "recommendation": "atry review new 1792208703 self",
          "schema": 1,
          "state": {
            "approved": true,
            "lifecycle": "reviewing",
            "stage": "implement",
          },
        },
        {
          "actions": [],
          "command": "none",
          "needsHuman": false,
          "read": [],
          "reason": "The run is closed or abandoned.",
          "recommendation": "none",
          "schema": 1,
          "state": {
            "approved": false,
            "lifecycle": "closed",
            "stage": "plan",
          },
        },
        {
          "actions": [],
          "command": "none",
          "needsHuman": false,
          "read": [],
          "reason": "The run is closed or abandoned.",
          "recommendation": "none",
          "schema": 1,
          "state": {
            "approved": false,
            "lifecycle": "abandoned",
            "stage": "plan",
          },
        },
      ]
    `);
  });
});

test("approve and close previews snapshot their prompt text", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "preview-snap",
      "--title",
      "Preview",
      "--json",
    ], dir);
    const run = JSON.parse(created.stdout) as { path: string };
    await writeFile(
      join(run.path, "10-plan/overview.md"),
      "# Overview\n\n## Goal\n\nShip the preview.\n\n## Decisions\n\n- Keep the headings exact.\n",
    );
    await writeFile(
      join(run.path, "10-plan/index.json"),
      `${
        JSON.stringify({
          schema: 1,
          tasks: [{ id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" }],
        })
      }\n`,
    );
    const approveText = await runCli(["approve", run.path, "--preview"], dir);
    const approveJson = await runCli(["approve", run.path, "--preview", "--json"], dir);
    expect(approveText.stdout).toMatchInlineSnapshot(`
      "Goal:
      Ship the preview.

      Decisions:
      - Keep the headings exact.

      tasks: 1
      "
    `);
    expect(JSON.parse(approveJson.stdout)).toMatchInlineSnapshot(`
      {
        "decisions": "- Keep the headings exact.",
        "goal": "Ship the preview.",
        "schema": 1,
        "tasks": 1,
      }
    `);
    const before = await readFile(join(run.path, "events.jsonl"), "utf8");

    const closeText = await runCli(["close", run.path, "--preview"], dir);
    const closeJson = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(closeText.stdout).toMatchInlineSnapshot(`
      "recommend: n
      missing self review
      "
    `);
    expect(JSON.parse(closeJson.stdout)).toMatchInlineSnapshot(`
      {
        "reasons": [
          "missing self review",
        ],
        "recommend": "n",
        "schema": 1,
      }
    `);
    expect(await readFile(join(run.path, "events.jsonl"), "utf8")).toBe(before);

    for (
      const args of [
        ["approve", run.path, "--via", "arg"],
        ["stage", "start", run.path, "implement", "--tool", "cursor"],
        ["task", "start", run.path, "T1"],
        ["task", "done", run.path, "T1"],
        ["stage", "done", run.path, "implement", "--tool", "cursor"],
      ]
    ) {
      const result = await runCli(args, dir);
      expect(result.code, result.stderr).toBe(0);
    }
    await runCli(["review", "new", run.path, "self", "--tool", "cursor"], dir);
    await runCli(["review", "done", run.path, "self"], dir);
    const ready = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(JSON.parse(ready.stdout)).toMatchInlineSnapshot(`
      {
        "reasons": [],
        "recommend": "y",
        "schema": 1,
      }
    `);
  });
});
