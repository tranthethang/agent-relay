import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { distillRun } from "../src/core/distill.js";
import { type EventLine } from "../src/core/event.js";
import {
  explainNext,
  explainNextWithChoices,
  formatAge,
  nextActions,
  nextStep,
  nextText,
} from "../src/core/next.js";
import { type RunState } from "../src/core/reduce.js";
import { type PlanIndex } from "../src/core/tasks.js";
import { withTempDir } from "./helper.js";

const fsHooks = vi.hoisted(() => ({ reverse: false, fake: false }));

const scramble = vi.hoisted(() => (entries: { name: string }[]): unknown[] => {
  const sorted = [...entries].sort((left, right) => left.name < right.name ? -1 : 1);
  const odd = sorted.filter((_, index) => index % 2 === 1);
  return [...odd, ...sorted.filter((_, index) => index % 2 === 0)];
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  const readdir = (async (...args: Parameters<typeof real.readdir>) => {
    const entries = (await real.readdir(...args)) as unknown as unknown[];
    const out = fsHooks.reverse ? scramble(entries as { name: string }[]) : [...entries];
    if (fsHooks.fake) {
      out.push({ name: "socket", isDirectory: () => false, isFile: () => false });
    }
    return out;
  }) as typeof real.readdir;
  return { ...real, readdir, default: { ...real, readdir } };
});

const id = "1792208725";

function ev(stage: EventLine["stage"], action: EventLine["action"]): EventLine {
  return { schema: 1, ts: "2026-10-17T00:00:00.000Z", stage, action };
}

function state(lifecycle: RunState["lifecycle"], tasks: RunState["tasks"] = []): RunState {
  return { lifecycle, stage: "self-review", approved: true, tasks };
}

const reviewing = state("reviewing");

test("nextStep finishes a started cross-review", () => {
  expect(nextStep(id, reviewing, [ev("cross-review", "started")])).toBe(
    `atry review done ${id} cross`,
  );
});

test("nextStep asks for a required self-review that is not done", () => {
  expect(nextStep(id, reviewing, [], { required: ["self", "cross"], done: [] })).toBe(
    `atry review new ${id} self`,
  );
});

test("nextStep closes when both reviews completed without a review list", () => {
  const events = [
    ev("self-review", "started"),
    ev("self-review", "completed"),
    ev("cross-review", "started"),
    ev("cross-review", "completed"),
  ];
  expect(nextStep(id, reviewing, events)).toBe(`atry close ${id}`);
});

test("lastStageAction ignores other actions for the stage", () => {
  const events = [ev("self-review", "started"), ev("self-review", "waived")];
  expect(nextStep(id, reviewing, events)).toBe(`atry review done ${id} self`);
});

test("nextActions without an index keeps a non-task recommendation", () => {
  const implementing = state("implementing");
  const done = `atry stage done ${id} implement`;
  expect(nextActions(id, implementing, [], done)).toEqual([done]);
  expect(nextActions(id, implementing, [], done, undefined, null)).toEqual([done]);
});

test("nextActions lists the run when open tasks are blocked", () => {
  const index: PlanIndex = {
    schema: 1,
    tasks: [
      { id: "T1", title: "One", deps: [], files: ["a.ts"], path: "10-plan/T1.md" },
      { id: "T2", title: "Two", deps: ["T1"], files: ["b.ts"], path: "10-plan/T2.md" },
    ],
  };
  const implementing = state("implementing", [{ id: "T1", status: "in-progress" }]);
  expect(nextActions(id, implementing, [], `atry task start ${id}`, undefined, index)).toEqual([
    `atry list ${id}`,
  ]);
});

test("nextActions keeps the recommendation while a review runs", () => {
  const command = `atry review done ${id} self`;
  expect(
    nextActions(id, reviewing, [ev("self-review", "started")], command, {
      required: ["self"],
      done: [],
    }),
  ).toEqual([command]);
});

test("nextActions offers close preview when every review is done", () => {
  expect(
    nextActions(id, reviewing, [], `atry close ${id}`, { required: ["self"], done: ["self"] }),
  ).toEqual([`atry close ${id} --preview`]);
});

test("nextActions puts a different recommendation first", () => {
  const recommendation = `atry review decide ${id}`;
  expect(
    nextActions(id, reviewing, [], recommendation, { required: ["cross"], done: [] }),
  ).toEqual([recommendation, `atry review new ${id} cross`, `atry close ${id} --preview`]);
});

test("nextText reports an unknown state", () => {
  const text = nextText(explainNextWithChoices("none", undefined, []));
  expect(text).toBe("state: unknown\nrecommendation: none\nactions: none\n");
});

test("explainNext gives a reason for each review command", () => {
  expect(explainNext(`atry review new ${id} self`).reason).toBe(
    "No self-review covers the current tree.",
  );
  expect(explainNext(`atry review done ${id} self`).reason).toBe("Self-review has started.");
  expect(explainNext(`atry review new ${id} cross`).reason).toBe("Cross-review has not started.");
  expect(explainNext(`atry review done ${id} cross`).reason).toBe("Cross-review has started.");
  expect(explainNext(`atry review new ${id} other`).reason).toBe(
    "The next command comes from the run state.",
  );
});

test("distillRun sorts entries from any readdir order and skips non-files", async () => {
  await withTempDir(async (dir) => {
    for (const name of ["a.md", "b.md", "c.md", "d.md", ".keep", ".x.tmp"]) {
      await writeFile(join(dir, name), name);
    }
    // The manifest header reads a real run.json and events.jsonl.
    await writeFile(
      join(dir, "run.json"),
      `${
        JSON.stringify({
          schema: 1,
          id: "1792849354",
          ymd: "20261024",
          slug: "sorted-run",
          title: "Sorted run",
          base: "abc",
          state: { lifecycle: "planned", stage: "plan", approved: false, tasks: [] },
        })
      }\n`,
    );
    await writeFile(join(dir, "events.jsonl"), "");
    await mkdir(join(dir, "locks"));
    await writeFile(join(dir, "locks", "run.lock"), "lock");
    await mkdir(join(dir, "sub", "locks"), { recursive: true });
    await writeFile(join(dir, "sub", "locks", "e.md"), "e");
    const expected = [
      ".keep",
      "a.md",
      "b.md",
      "c.md",
      "d.md",
      "events.jsonl",
      "run.json",
      "sub/locks/e.md",
    ];
    fsHooks.reverse = true;
    fsHooks.fake = true;
    try {
      expect((await distillRun(dir)).files).toBe(expected.length);
      expect((await distillRun(dir)).files).toBe(expected.length);
    } finally {
      fsHooks.reverse = false;
      fsHooks.fake = false;
    }
    const manifest = JSON.parse(
      await readFile(join(dir, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    expect(manifest.files.map((file) => file.path)).toEqual(expected);
  });
});

test("formatAge picks minutes, hours, or days", () => {
  expect(formatAge(0, 5 * 60000)).toBe("5m");
  expect(formatAge(0, 3 * 3600000)).toBe("3h");
  expect(formatAge(0, 72 * 3600000)).toBe("3d");
});

test("nextStep walks the lifecycle before review", () => {
  expect(nextStep(id, state("planned"), [])).toBe(`atry approve ${id}`);
  expect(nextStep(id, state("approved"), [])).toBe(`atry stage start ${id} implement`);
  expect(nextStep(id, state("closed"), [])).toBe("none");
  expect(nextStep(id, state("abandoned"), [])).toBe("none");
  expect(nextStep(id, state("implementing", [{ id: "T1", status: "pending" }]), [])).toBe(
    `atry task start ${id}`,
  );
  expect(nextStep(id, state("implementing"), [], undefined, null)).toBe(
    `atry stage done ${id} implement`,
  );
  expect(nextStep(id, reviewing, [ev("self-review", "started")])).toBe(
    `atry review done ${id} self`,
  );
});

test("nextStep picks the missing review", () => {
  const reviews = { required: ["self", "cross"], done: ["self"] };
  expect(nextStep(id, reviewing, [], reviews)).toBe(`atry review new ${id} cross`);
  expect(nextStep(id, reviewing, [], { required: ["self"], done: ["self"] })).toBe(
    `atry close ${id}`,
  );
  expect(nextStep(id, reviewing, [])).toBe(`atry review new ${id} self`);
  const selfDone = [ev("self-review", "started"), ev("self-review", "completed")];
  expect(nextStep(id, reviewing, selfDone)).toBe(`atry review new ${id} cross`);
});

test("nextActions covers each lifecycle", () => {
  const rec = `atry approve ${id}`;
  expect(nextActions(id, state("closed"), [], "none")).toEqual([]);
  expect(nextActions(id, state("abandoned"), [], "none")).toEqual([]);
  expect(nextActions(id, state("planned"), [], rec)).toEqual([rec]);
  expect(nextActions(id, state("implementing"), [], `atry task start ${id}`)).toEqual([
    `atry list ${id}`,
  ]);
  const index: PlanIndex = {
    schema: 1,
    tasks: [
      { id: "T1", title: "One", deps: [], files: ["a.ts"], path: "10-plan/T1.md" },
      { id: "T2", title: "Two", deps: ["T1"], files: ["b.ts"], path: "10-plan/T2.md" },
      { id: "T3", title: "Three", deps: ["T1", "T4"], files: ["c.ts"], path: "10-plan/T3.md" },
      { id: "T4", title: "Four", deps: [], files: ["d.ts"], path: "10-plan/T4.md" },
      { id: "T5", title: "Five", deps: ["T6"], files: ["e.ts"], path: "10-plan/T5.md" },
    ],
  };
  const running = state("implementing", [
    { id: "T1", status: "done" },
    { id: "T4", status: "skipped" },
  ]);
  expect(nextActions(id, running, [], `atry task start ${id}`, undefined, index)).toEqual([
    `atry task start ${id} T2`,
    `atry task start ${id} T3`,
  ]);
  const finished = state(
    "implementing",
    index.tasks.map((task) => ({ id: task.id, status: "done" as const })),
  );
  const done = `atry stage done ${id} implement`;
  expect(nextActions(id, finished, [], done, undefined, index)).toEqual([done]);
  const review = `atry review new ${id} self`;
  expect(nextActions(id, reviewing, [], review)).toEqual([review]);
  expect(nextActions(id, reviewing, [], review, { required: ["self"], done: [] })).toEqual([
    review,
    `atry close ${id} --preview`,
  ]);
});

test("nextText prints state and marks developer decisions", () => {
  const result = explainNextWithChoices(`atry close ${id}`, reviewing, [
    `atry close ${id}`,
    `atry task start ${id} T2`,
  ]);
  expect(result.actions[1]?.read).toEqual(["10-plan/overview.md", "10-plan/T2.md"]);
  expect(nextText(result)).toBe(
    "state: self-review/reviewing approved=true\n"
      + `recommendation: atry close ${id} --preview\n`
      + "actions:\n"
      + `- atry close ${id} --preview — The run is ready for a developer close decision. (developer decision)\n`
      + `- atry task start ${id} T2 — An implement task is still open.\n`,
  );
});

test("explainNext gives a reason for each lifecycle command", () => {
  expect(explainNext(`atry stage start ${id} implement`).reason).toBe(
    "Implement has not started.",
  );
  expect(explainNext(`atry stage done ${id} implement`).reason).toBe(
    "Every implement task is done or skipped.",
  );
  expect(explainNext(`atry approve ${id}`).reason).toBe("The plan is waiting for approval.");
  expect(explainNext(`atry review decide ${id} 1`).reason).toBe(
    "A review question is still open.",
  );
});

test("each action kind gets a question only when a person decides", () => {
  const approve = explainNext(`atry approve ${id}`).actions[0];
  expect(approve).toMatchObject({
    kind: "approve",
    command: `atry approve ${id} --preview`,
    question: "Read the decision in the preview. Ask the developer to answer y or n.",
  });
  expect(explainNext(`atry approve ${id} --preview`).actions[0]?.command).toBe(
    `atry approve ${id} --preview`,
  );
  expect(explainNext(`atry close ${id}`).actions[0]).toMatchObject({
    kind: "close",
    command: `atry close ${id} --preview`,
    question: "Read the decision in the preview. Ask the developer to answer y or n.",
  });
  expect(explainNext(`atry review decide ${id} 1`).actions[0]?.question).toBe(
    "Ask the developer to answer the open review questions.",
  );
  const commands: [string, string][] = [
    [`atry plan new ${id}`, "plan-new"],
    [`atry plan done ${id}`, "plan-done"],
    [`atry stage start ${id} implement`, "stage-start"],
    [`atry stage done ${id} implement`, "stage-done"],
    [`atry task start ${id} T1`, "task-start"],
    [`atry integrate ${id} T1`, "integrate"],
    [`atry review new ${id} self`, "review-new"],
    [`atry review new ${id} cross`, "review-new"],
    [`atry review done ${id} self`, "review-done"],
    [`atry review done ${id} cross`, "review-done"],
  ];
  for (const [command, kind] of commands) {
    const action = explainNext(command).actions[0];
    expect(action?.kind).toBe(kind);
    expect(action).not.toHaveProperty("question");
    expect(action?.needsHuman).toBe(false);
    if (kind === "stage-start" || kind === "stage-done") {
      expect(action?.command).toBe(`${command} --tool <tool>`);
    }
  }
  expect(explainNext(`atry review done ${id} cross`).actions[0]?.command).toBe(
    `atry review done ${id} cross`,
  );
});

test("review done asks to run the test command only when one is set", () => {
  const command = `atry review done ${id} self`;
  const withTests = explainNextWithChoices(command, reviewing, [command], "npm test");
  expect(withTests.actions[0]).toMatchObject({
    kind: "review-done",
    command: `${command} --run-tests`,
    needsHuman: true,
    question: "Run npm test and record the result?",
    args: { review: "self", run: id },
  });
  expect(withTests.needsHuman).toBe(true);
  const without = explainNextWithChoices(command, reviewing, [command]);
  expect(without.actions[0]?.command).toBe(command);
  expect(without.actions[0]?.needsHuman).toBe(false);
  expect(without.actions[0]).not.toHaveProperty("question");
  const close = explainNextWithChoices(`atry close ${id}`, reviewing, [`atry close ${id}`], "x");
  expect(close.actions[0]?.command).toBe(`atry close ${id} --preview`);
});
