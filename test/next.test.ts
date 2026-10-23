import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { type EventLine } from "../src/core/event.js";
import { explainNext, formatAge, nextActions, nextStep } from "../src/core/next.js";
import { reduceEvents } from "../src/core/reduce.js";
import { type PlanIndex } from "../src/core/tasks.js";
import { gitCommit, runCli, withTempDir, withTempGitRepo } from "./helper.js";
import { plannedState, runCache, seedRelay, seedRun } from "./seed.js";

const start = Date.parse("2026-10-17T00:00:00.000Z");

function ev(stage: EventLine["stage"], action: EventLine["action"]): EventLine {
  return { schema: 1, ts: "2026-10-17T00:00:00.000Z", stage, action };
}

test("formatAge uses minutes, hours, then days", () => {
  expect(formatAge(start, start + 5 * 60000)).toBe("5m");
  expect(formatAge(start, start + 2 * 3600000)).toBe("2h");
  expect(formatAge(start, start + 3 * 86400000)).toBe("3d");
  expect(formatAge(start, start - 1000)).toBe("0m");
});

test("explainNext marks approve, close, and decide as human steps", () => {
  expect(explainNext("atry approve 1792208725")).toMatchObject({
    needsHuman: true,
    read: ["10-plan/overview.md", "10-plan/index.json"],
    reason: "The plan is waiting for approval.",
  });
  expect(explainNext("atry close 1792208725").needsHuman).toBe(true);
  expect(explainNext("atry review decide 1792208725").needsHuman).toBe(true);
  expect(explainNext("atry stage start 1792208725 implement").needsHuman).toBe(false);
  expect(explainNext("none")).toMatchObject({
    needsHuman: false,
    read: [],
    reason: "The run is closed or abandoned.",
  });
});

test("each action carries a kind, args, and its requirement flags", () => {
  const id = "1792208725";
  const approve = explainNext(`atry approve ${id}`).actions[0];
  expect(approve).toMatchObject({ kind: "approve", args: { run: id } });

  const task = explainNext(`atry task start ${id} T2`).actions[0];
  expect(task).toMatchObject({
    kind: "task-start",
    args: { run: id, task: "T2" },
  });
  expect(task?.requiresSession).toBeUndefined();
  expect(task?.read).toEqual(["10-plan/overview.md", "10-plan/T2.md"]);

  const cross = explainNext(`atry review new ${id} cross`).actions[0];
  expect(cross).toMatchObject({
    kind: "review-new",
    args: { run: id, review: "cross" },
    requiresModel: true,
  });
  expect(cross?.read.length).toBeGreaterThan(0);

  const selfDone = explainNext(`atry review done ${id} self`).actions[0];
  expect(selfDone).toMatchObject({ kind: "review-done", args: { run: id, review: "self" } });
  expect(selfDone?.requiresModel).toBeUndefined();

  const stageStart = explainNext(`atry stage start ${id} implement`).actions[0];
  expect(stageStart).toMatchObject({
    kind: "stage-start",
    args: { run: id, stage: "implement" },
  });
  expect(stageStart?.read).toEqual(["10-plan/overview.md", "10-plan/index.json"]);

  const close = explainNext(`atry close ${id} --preview`).actions[0];
  expect(close).toMatchObject({ kind: "close", args: { run: id } });
  expect(close?.read.length).toBeGreaterThan(0);

  const decide = explainNext(`atry review decide ${id} Q1 a`).actions[0];
  expect(decide?.kind).toBe("decide");
  expect(decide?.needsHuman).toBe(true);

  const list = explainNext(`atry list ${id}`).actions[0];
  expect(list).toMatchObject({ kind: "none", args: { run: id } });
  expect(list?.read).toEqual(["10-plan/index.json"]);
});

test("nextStep uses the plan index when run state has no task row", () => {
  const events = [ev("implement", "started")];
  const state = reduceEvents(events);
  const pending = {
    schema: 1 as const,
    tasks: [{
      id: "T1" as const,
      title: "First",
      deps: [],
      files: ["src/core/tasks.ts"],
      path: "10-plan/T1.md",
    }],
  };
  expect(nextStep("1792208725", state, events, undefined, pending)).toBe(
    "atry task start 1792208725",
  );
  expect(nextStep("1792208725", state, events, undefined, { schema: 1, tasks: [] })).toBe(
    "atry stage done 1792208725 implement",
  );
});

test("nextStep walks the plan state before approve", () => {
  const id = "1792208725";
  const planned = reduceEvents([ev("run", "created")]);
  const index: PlanIndex = {
    schema: 1,
    tasks: [{ id: "T1", title: "One", deps: [], files: [], path: "10-plan/T1.md" }],
  };
  expect(
    nextStep(id, planned, [], undefined, null, [], {
      overview: false,
      tasksInput: false,
      index: null,
      ready: false,
    }),
  ).toBe(`atry plan new ${id}`);
  expect(
    nextStep(id, planned, [], undefined, null, [], {
      overview: true,
      tasksInput: true,
      index: null,
      ready: false,
    }),
  ).toBe(`atry plan done ${id}`);
  expect(
    nextStep(id, planned, [], undefined, null, [], {
      overview: true,
      tasksInput: true,
      index,
      ready: false,
    }),
  ).toBe(`atry approve ${id} --preview`);
  expect(
    nextStep(id, planned, [], undefined, null, [], {
      overview: true,
      tasksInput: true,
      index,
      ready: true,
    }),
  ).toBe(`atry approve ${id}`);
  expect(nextStep(id, planned, [])).toBe(`atry approve ${id}`);
  expect(explainNext(`atry approve ${id} --preview`).actions[0]).toMatchObject({
    kind: "approve",
    reason: "The plan is incomplete.",
  });
  expect(explainNext(`atry close ${id} --preview`).actions[0]).toMatchObject({
    kind: "close",
    reason: "The run is ready for a developer close decision.",
  });
  expect(explainNext(`atry plan done ${id}`).actions[0]).toMatchObject({
    kind: "plan-done",
    read: ["10-plan/", "10-plan/tasks.input.json"],
  });
  expect(explainNext(`atry plan new ${id}`).actions[0]).toMatchObject({
    kind: "plan-new",
    read: ["10-plan/"],
  });
});

test("nextStep names the following verb", () => {
  const approved = [ev("plan", "approved")];
  expect(nextStep("1792208725", reduceEvents(approved), approved)).toBe(
    "atry stage start 1792208725 implement",
  );
  const open = [ev("implement", "started"), { ...ev("implement", "task-started"), task: "T1" }];
  expect(nextStep("1792208725", reduceEvents(open), open)).toBe("atry task start 1792208725");
  const reviewing = [ev("implement", "completed"), ev("self-review", "completed")];
  expect(nextStep("1792208725", reduceEvents(reviewing), reviewing)).toBe(
    "atry review new 1792208725 cross",
  );
  const closed = [ev("run", "closed")];
  expect(nextStep("1792208725", reduceEvents(closed), closed)).toBe("none");
});

test("nextStep closes after the reviews required by policy", () => {
  const events = [ev("implement", "completed"), ev("self-review", "completed")];
  expect(nextStep("1792208725", reduceEvents(events), events, {
    required: ["self"],
    done: ["self"],
  })).toBe("atry close 1792208725");
  const rerun = [...events, ev("self-review", "started")];
  expect(nextStep("1792208725", reduceEvents(rerun), rerun, {
    required: ["self"],
    done: ["self"],
  })).toBe("atry review done 1792208725 self");
});

test("nextStep asks for a self-review after a cross-review delta", () => {
  const id = "1792208725";
  const reviews = { required: ["self", "cross"], done: ["self", "cross"] };
  const events = [
    ev("implement", "completed"),
    ev("self-review", "completed"),
    { ...ev("cross-review", "completed"), delta: { files: 1, added: 1, deleted: 0 } },
  ];
  expect(nextStep(id, reduceEvents(events), events, reviews)).toBe(`atry review new ${id} self`);
  expect(nextActions(id, reduceEvents(events), events, `atry review new ${id} self`, reviews))
    .toEqual([`atry review new ${id} self`, `atry close ${id} --preview`]);

  const covered = [...events, ev("self-review", "completed")];
  expect(nextStep(id, reduceEvents(covered), covered, reviews)).toBe(`atry close ${id}`);
});

test("nextStep does not ask for a self-review when the cross review has no delta", () => {
  const id = "1792208725";
  const reviews = { required: ["self", "cross"], done: ["self", "cross"] };
  const events = [
    ev("implement", "completed"),
    ev("self-review", "completed"),
    ev("cross-review", "completed"),
  ];
  expect(nextStep(id, reduceEvents(events), events, reviews)).toBe(`atry close ${id}`);
});

test("nextActions lists eligible tasks and review or close choices", () => {
  const events = [ev("implement", "started")];
  const state = reduceEvents(events);
  const index = {
    schema: 1 as const,
    tasks: [
      { id: "T1" as const, title: "First", deps: [], files: [], path: "10-plan/T1.md" },
      { id: "T2" as const, title: "Second", deps: [], files: [], path: "10-plan/T2.md" },
    ],
  };
  expect(nextActions("1792208725", state, events, "atry task start 1792208725", undefined, index))
    .toEqual(["atry task start 1792208725 T1", "atry task start 1792208725 T2"]);

  const reviewingEvents = [ev("implement", "completed")];
  const reviewing = reduceEvents(reviewingEvents);
  expect(nextActions("1792208725", reviewing, reviewingEvents, "atry review new 1792208725 self", {
    required: ["self", "cross"],
    done: [],
  })).toEqual([
    "atry review new 1792208725 self",
    "atry review new 1792208725 cross",
    "atry close 1792208725 --preview",
  ]);
});

test("next walks the plan states before approve", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await runCli([
      "run",
      "new",
      "--slug",
      "next-plan",
      "--title",
      "Next plan",
      "--json",
    ], dir);
    expect(created.code, created.stderr).toBe(0);
    const run = JSON.parse(created.stdout) as { path: string; id: string };

    const empty = await runCli(["next", run.id, "--json"], dir);
    expect(JSON.parse(empty.stdout)).toMatchObject({ command: `atry plan new ${run.id}` });

    await runCli(["plan", "new", run.path], dir);
    await writeFile(
      join(run.path, "10-plan", "overview.md"),
      "# Overview\n\n## Goal\n\nShip the plan.\n",
    );
    await writeFile(
      join(run.path, "10-plan", "tasks.input.json"),
      `${JSON.stringify({ schema: 1, tasks: [{ title: "One", deps: [], files: [] }] })}\n`,
    );
    const noIndex = await runCli(["next", run.id, "--json"], dir);
    expect(JSON.parse(noIndex.stdout)).toMatchObject({ command: `atry plan done ${run.id}` });

    await runCli(["plan", "done", run.path], dir);
    const thin = await runCli(["next", run.id, "--json"], dir);
    expect(JSON.parse(thin.stdout)).toMatchObject({
      command: `atry approve ${run.id} --preview`,
      reason: "The plan is incomplete.",
    });

    await writeFile(
      join(run.path, "10-plan", "T1.md"),
      "# T1: One\n\n## Detail\n\nDo it.\n\n## Acceptance\n\n- It works.\n",
    );
    const ready = await runCli(["next", run.id, "--json"], dir);
    expect(JSON.parse(ready.stdout)).toMatchObject({ command: `atry approve ${run.id}` });
  });
});

test("atry next covers each lifecycle", async () => {
  const cases: {
    lifecycle: string;
    events: EventLine[];
    command: string;
    kind: string;
    needsHuman: boolean;
  }[] = [
    {
      lifecycle: "planned",
      events: [ev("run", "created")],
      command: "atry plan new 1792208725",
      kind: "plan-new",
      needsHuman: false,
    },
    {
      lifecycle: "approved",
      events: [ev("run", "created"), ev("plan", "approved")],
      command: "atry stage start 1792208725 implement",
      kind: "stage-start",
      needsHuman: false,
    },
    {
      lifecycle: "implementing",
      events: [
        ev("run", "created"),
        ev("plan", "approved"),
        ev("implement", "started"),
        { ...ev("implement", "task-started"), task: "T1" },
      ],
      command: "atry list 1792208725",
      kind: "none",
      needsHuman: false,
    },
    {
      lifecycle: "reviewing",
      events: [
        ev("run", "created"),
        ev("plan", "approved"),
        ev("implement", "started"),
        ev("implement", "completed"),
      ],
      command: "atry review new 1792208725 self",
      kind: "review-new",
      needsHuman: false,
    },
    {
      lifecycle: "closed",
      events: [ev("run", "created"), ev("run", "closed")],
      command: "none",
      kind: "none",
      needsHuman: false,
    },
    {
      lifecycle: "abandoned",
      events: [ev("run", "created"), ev("run", "abandoned")],
      command: "none",
      kind: "none",
      needsHuman: false,
    },
  ];

  await withTempDir(async (root) => {
    const relay = await seedRelay(root);
    for (const [index, item] of cases.entries()) {
      const id = `17922087${String(index).padStart(2, "0")}`;
      const name = `20261017-${id}-${item.lifecycle}-case`;
      const cache = {
        ...(runCache(plannedState) as { slug: string; id: string }),
        id,
        slug: `${item.lifecycle}-case`,
      };
      await seedRun(relay, name, cache, item.events);
      const command = item.command.replaceAll("1792208725", id);
      const result = await runCli(["next", "--json", name], root);
      expect(result.code, `${item.lifecycle} ${result.stderr}`).toBe(0);
      const body = JSON.parse(result.stdout) as {
        actions: { kind: string; read: string[] }[];
      };
      expect(body).toMatchObject({
        schema: 1,
        command,
        needsHuman: item.needsHuman,
      });
      for (const action of body.actions) {
        expect(action.kind).toBe(item.kind);
        if (command === "none") expect(action.read).toEqual([]);
        else expect(action.read.length).toBeGreaterThan(0);
      }
      if (command === "none") expect(body.actions).toEqual([]);
      const text = await runCli(["next", name], root);
      expect(text.stdout).toContain(`recommendation: ${command}`);
      expect(text.stdout).toContain("state:");
      expect(text.stdout).toContain("actions:");
    }
  });
});

test("next recommends integrate for a done task that still has a worktree", () => {
  const events = [
    ev("run", "created"),
    ev("plan", "approved"),
    ev("implement", "started"),
    { ...ev("implement", "task-done"), task: "T1" },
    { ...ev("implement", "task-started"), task: "T2" },
  ];
  const state = reduceEvents(events);
  const index = {
    schema: 1,
    tasks: [
      { id: "T1", title: "First", deps: [], files: ["a.ts"], path: "10-plan/T1.md" },
      { id: "T2", title: "Second", deps: ["T1"], files: ["b.ts"], path: "10-plan/T2.md" },
    ],
  } satisfies PlanIndex;
  const command = "atry integrate 1792208725 T1";
  expect(nextStep("1792208725", state, events, undefined, index, ["T1", "T2"])).toBe(command);
  expect(nextActions("1792208725", state, events, command, undefined, index, ["T1", "T2"])).toEqual(
    [
      command,
    ],
  );
  expect(explainNext(command).actions[0]).toMatchObject({
    kind: "integrate",
    args: { run: "1792208725", task: "T1" },
    read: ["10-plan/overview.md", "10-plan/T1.md"],
    reason: "A done task still has a worktree.",
  });
});
