import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  createFixture,
  fileCheckFailures,
  type Fixture,
  fixtureKinds,
  loadScenarios,
  parseScenarios,
  scenarioPrompt,
} from "../evals/model/fixtures.js";
import { matchTrajectory, parseEvents } from "../evals/model/trajectory.js";
import { runCli } from "./helper.js";

const open: Fixture[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((fixture) => fixture.cleanup()));
});

async function build(kind: (typeof fixtureKinds)[number]): Promise<Fixture> {
  const fixture = await createFixture(kind);
  open.push(fixture);
  return fixture;
}

async function events(fixture: Fixture) {
  return parseEvents(await readFile(join(fixture.runPath, "events.jsonl"), "utf8"));
}

test("the scenario file parses and each fixture kind is used", async () => {
  const scenarios = await loadScenarios();
  expect(scenarios.map((s) => s.name)).toEqual([
    "brainstorm-readonly",
    "plan-small",
    "implement-approved",
    "self-review",
  ]);
  expect(new Set(scenarios.map((s) => s.fixture))).toEqual(new Set(fixtureKinds));
});

test("a scenario with an unknown fixture is rejected", () => {
  const bad = {
    schema: 1,
    scenarios: [{
      name: "x",
      skill: "s",
      prompt: "p",
      fixture: "nope",
      required: [],
      forbidden: [],
      fileCheck: "none",
    }],
  };
  expect(() => parseScenarios(JSON.stringify(bad))).toThrow();
});

test("each required list is valid input for the matcher", async () => {
  for (const scenario of await loadScenarios()) {
    const result = matchTrajectory([], scenario);
    expect(result.required).toBe(scenario.required.length);
  }
});

test("clean and small-file fixtures are clean repos with no run", async () => {
  for (const kind of ["clean", "small-file"] as const) {
    const fixture = await build(kind);
    expect(fixture.runPath).toBe("");
    expect(await fileCheckFailures(fixture, "clean-tree")).toEqual([]);
  }
  const small = await build("small-file");
  expect(await readFile(join(small.repo, "src", "greet.ts"), "utf8")).toContain("hello");
});

test("approved-two-tasks reaches approved with two tasks and no implement event", async () => {
  const fixture = await build("approved-two-tasks");
  const seen = await events(fixture);
  expect(seen.at(-1)).toEqual({ stage: "plan", action: "approved" });
  expect(seen.some((e) => e.stage === "implement")).toBe(false);
  const list = await runCli(["list", fixture.runPath], fixture.repo);
  expect(list.stdout, list.stderr).toContain("T2");
});

test("implemented reaches implement completed with no review", async () => {
  const fixture = await build("implemented");
  const seen = await events(fixture);
  expect(seen.at(-1)).toEqual({ stage: "implement", action: "completed" });
  expect(seen.some((e) => e.stage === "self-review")).toBe(false);
});

test("a dirty tree fails the clean-tree check and none always passes", async () => {
  const fixture = await build("clean");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(fixture.repo, "README.md"), "changed\n");
  expect((await fileCheckFailures(fixture, "clean-tree"))[0]).toContain("not clean");
  expect(await fileCheckFailures(fixture, "none")).toEqual([]);
});

test("scenarioPrompt fills the run path", async () => {
  const scenario = (await loadScenarios()).find((s) => s.name === "self-review")!;
  expect(scenarioPrompt(scenario, "/r/run")).toContain("/r/run");
  expect(scenarioPrompt(scenario, "/r/run")).not.toContain("{run}");
});
