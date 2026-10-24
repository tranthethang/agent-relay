import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { realScenarioNames } from "../evals/real.ts";
import { withTempDir } from "./helper.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const runPath = fileURLToPath(new URL("../evals/run.ts", import.meta.url));
const scenariosPath = fileURLToPath(new URL("../evals/scenarios.json", import.meta.url));

function runEvals(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, ["--experimental-strip-types", runPath, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

type Collection = {
  schema: number;
  maxTokens: number;
  maxSteps: number;
  scenarios: { name: string; skill: string; steps: { argv: string[]; exit: number }[] }[];
};

function copyBundles(dir: string): void {
  cpSync(join(repoRoot, "skills"), join(dir, "skills"), { recursive: true });
  cpSync(join(repoRoot, "scripts/maint"), join(dir, "scripts/maint"), { recursive: true });
}

function readCollection(): Collection {
  return JSON.parse(readFileSync(scenariosPath, "utf8")) as Collection;
}

test("the fake layer passes on every skill bundle", () => {
  const result = runEvals(["--layer", "fake"]);
  const count = readCollection().scenarios.length;
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain(`evals: ${count}/${count} passed`);
});

test("a scenario with a wrong command exits 1 and names the step", async () => {
  await withTempDir(async (dir) => {
    const collection = readCollection();
    const scenario = collection.scenarios.find((item) => item.name === "normal-plan");
    if (scenario?.steps[0] === undefined) throw new Error("normal-plan scenario missing");
    scenario.steps[0].argv = ["done", "1792661001"];
    const path = join(dir, "scenarios.json");
    writeFileSync(path, `${JSON.stringify(collection)}\n`);
    const result = runEvals(["--scenario", "normal-plan", "--scenarios", path]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("fail: normal-plan: step 1:");
    expect(result.stderr).toContain("is not an atry command");
  });
});

test("a JSON response without schema 1 fails the scenario", async () => {
  await withTempDir(async (dir) => {
    const collection = readCollection();
    const scenario = collection.scenarios.find((item) => item.name === "out-of-scope-edit");
    if (scenario?.steps[0] === undefined) throw new Error("out-of-scope-edit scenario missing");
    const stdout = scenario.steps[0] as { stdout?: { schema?: number } };
    if (stdout.stdout !== undefined) stdout.stdout.schema = 2;
    const path = join(dir, "scenarios.json");
    writeFileSync(path, `${JSON.stringify(collection)}\n`);
    const result = runEvals(["--scenario", "out-of-scope-edit", "--scenarios", path]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("schema must be 1");
  });
});

test("the collection keeps every scenario offline and inside one skill", () => {
  const collection = readCollection();
  expect(collection.schema).toBe(1);
  expect(collection.maxTokens).toBe(4500);
  for (const scenario of collection.scenarios) {
    expect(scenario.skill).toMatch(/^atry-[a-z-]+$/);
    expect(scenario.steps.length).toBeGreaterThan(0);
    expect(scenario.steps.length).toBeLessThanOrEqual(collection.maxSteps);
    for (const step of scenario.steps) {
      expect(step.argv.length).toBeGreaterThan(0);
      expect(step.argv[0]).not.toBe("atry");
    }
  }
  const names = collection.scenarios.map((scenario) => scenario.name);
  expect(names).toContain("missing-cli");
  expect(new Set(names).size).toBe(names.length);
});

test("--list prints one line for each fake and real scenario", () => {
  const result = runEvals(["--list"]);
  const count = readCollection().scenarios.length + realScenarioNames().length;
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toHaveLength(count);
});

test("a wrong expected exit code fails the real layer", () => {
  const result = runEvals(["--layer", "real", "--scenario", "real-plan-gate", "--drift"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("fail: real-plan-gate:");
  expect(result.stderr).toContain("does not match");
});

test("--drift without the real layer is a usage error", () => {
  const result = runEvals(["--layer", "fake", "--drift"]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("--drift needs the real layer");
});

test("CI runs the eval layers on the three operating systems", () => {
  const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  expect(yaml).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
  expect(yaml).toContain("npm run evals");
});

test("a skill without the LOOP block fails a step whose verb comes from next", async () => {
  await withTempDir(async (dir) => {
    copyBundles(dir);
    const skill = join(dir, "skills/atry-self-review/SKILL.md");
    const text = readFileSync(skill, "utf8")
      .replace(/<!-- BEGIN LOOP -->[\s\S]*<!-- END LOOP -->/, "");
    writeFileSync(skill, text);
    const result = runEvals(["--layer", "fake", "--scenario", "close-warning", "--root", dir]);
    const crossText = readFileSync(join(dir, "skills/atry-cross-review/SKILL.md"), "utf8");
    expect(crossText).toContain("<!-- BEGIN LOOP -->");
    const own = runEvals(["--layer", "fake", "--scenario", "open-question", "--root", dir]);
    expect(own.status).toBe(1);
    expect(own.stderr).toContain("SKILL.md has no LOOP block for \"atry review new\"");
    expect(result.stderr).not.toContain("LOOP block");
  });
});

test("a skill that lacks a verb outside the next list still fails", async () => {
  await withTempDir(async (dir) => {
    copyBundles(dir);
    const skill = join(dir, "skills/atry-plan/SKILL.md");
    writeFileSync(skill, readFileSync(skill, "utf8").replaceAll("atry plan done", "atry plan"));
    const result = runEvals(["--layer", "fake", "--scenario", "normal-plan", "--root", dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SKILL.md does not declare \"atry plan done\"");
  });
});
