import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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
      command: "atry plan new",
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
              "args": {
                "run": "1792208700",
              },
              "command": "atry plan new 1792208700",
              "kind": "plan-new",
              "needsHuman": false,
              "read": [
                "10-plan/",
              ],
              "reason": "The plan has no overview or task input.",
            },
          ],
          "command": "atry plan new 1792208700",
          "needsHuman": false,
          "read": [
            "10-plan/",
          ],
          "reason": "The plan has no overview or task input.",
          "recommendation": "atry plan new 1792208700",
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
              "args": {
                "run": "1792208701",
                "stage": "implement",
              },
              "command": "atry stage start 1792208701 implement --tool <tool>",
              "kind": "stage-start",
              "needsHuman": false,
              "read": [
                "10-plan/overview.md",
                "10-plan/index.json",
              ],
              "reason": "Implement has not started.",
            },
          ],
          "command": "atry stage start 1792208701 implement --tool <tool>",
          "needsHuman": false,
          "read": [
            "10-plan/overview.md",
            "10-plan/index.json",
          ],
          "reason": "Implement has not started.",
          "recommendation": "atry stage start 1792208701 implement --tool <tool>",
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
              "args": {
                "run": "1792208702",
              },
              "command": "atry list 1792208702",
              "kind": "none",
              "needsHuman": false,
              "read": [
                "10-plan/index.json",
              ],
              "reason": "No pending task is ready to start.",
            },
          ],
          "command": "atry list 1792208702",
          "needsHuman": false,
          "read": [
            "10-plan/index.json",
          ],
          "reason": "No pending task is ready to start.",
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
              "args": {
                "review": "self",
                "run": "1792208703",
              },
              "command": "atry review new 1792208703 self --tool <tool>",
              "kind": "review-new",
              "needsHuman": false,
              "read": [
                "10-plan/overview.md",
                "20-implement/",
              ],
              "reason": "No self-review covers the current tree.",
            },
          ],
          "command": "atry review new 1792208703 self --tool <tool>",
          "needsHuman": false,
          "read": [
            "10-plan/overview.md",
            "20-implement/",
          ],
          "reason": "No self-review covers the current tree.",
          "recommendation": "atry review new 1792208703 self --tool <tool>",
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
    await writeFile(
      join(run.path, "10-plan/T1.md"),
      "# T1: One\n\n## Detail\n\nDo the task.\n\n## Acceptance\n\n- It works.\n",
    );
    const approveText = await runCli(["approve", run.path, "--preview"], dir);
    const approveJson = await runCli(["approve", run.path, "--preview", "--json"], dir);
    const named = (text: string) => text.replaceAll(basename(run.path), "<run>");
    expect(named(approveText.stdout)).toMatchInlineSnapshot(`
      "Goal:
      Ship the preview.

      Non-goals:


      Constraints:


      Decisions:
      - Keep the headings exact.

      tasks: 1
      - T1: One
      ready: yes
      question: Approve the plan for <run> with 1 tasks?
      on yes: atry approve <run> --via confirm
      "
    `);
    expect(JSON.parse(named(approveJson.stdout))).toMatchInlineSnapshot(`
      {
        "constraints": "",
        "decision": {
          "onNo": null,
          "onYes": "atry approve <run> --via confirm",
          "onYesArg": "atry approve <run> --via arg",
          "question": "Approve the plan for <run> with 1 tasks?",
        },
        "decisions": "- Keep the headings exact.",
        "goal": "Ship the preview.",
        "missing": [],
        "nonGoals": "",
        "ready": true,
        "schema": 1,
        "taskFiles": [
          {
            "acceptance": "- It works.",
            "acceptanceOk": true,
            "detail": "Do the task.",
            "detailOk": true,
            "files": [],
            "id": "T1",
            "title": "One",
          },
        ],
        "tasks": 1,
      }
    `);
    const before = await readFile(join(run.path, "events.jsonl"), "utf8");

    const closeText = await runCli(["close", run.path, "--preview"], dir);
    const closeJson = await runCli(["close", run.path, "--preview", "--json"], dir);
    expect(named(closeText.stdout)).toMatchInlineSnapshot(`
      "recommend: n
      missing self review
      question: missing self review. Close <run>?
      on yes: atry close <run> --via confirm --ack-warnings
      "
    `);
    expect(JSON.parse(named(closeJson.stdout))).toMatchInlineSnapshot(`
      {
        "decision": {
          "onNo": null,
          "onYes": "atry close <run> --via confirm --ack-warnings",
          "onYesArg": "atry close <run> --via arg --ack-warnings",
          "question": "missing self review. Close <run>?",
        },
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
    expect(JSON.parse(named(ready.stdout))).toMatchInlineSnapshot(`
      {
        "decision": {
          "onNo": null,
          "onYes": "atry close <run> --via confirm",
          "onYesArg": "atry close <run> --via arg",
          "question": "Close <run>?",
        },
        "reasons": [],
        "recommend": "y",
        "schema": 1,
      }
    `);
  });
});
