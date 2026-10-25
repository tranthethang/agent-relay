import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("CI runs check, build, and test on ubuntu, macos, and windows", () => {
  const yaml = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  expect(yaml).toContain("os: [ubuntu-latest, macos-latest, windows-latest]");
  expect(yaml).toContain("npm run check");
  expect(yaml).toContain("npm run build");
  expect(yaml).toContain("npm test");
});

const modelYaml = () =>
  readFileSync(new URL("../.github/workflows/model-evals.yml", import.meta.url), "utf8")
    .replaceAll("\r\n", "\n");

test("the model eval workflow runs only on a nightly schedule and by hand", () => {
  const yaml = modelYaml();
  const on = yaml.slice(yaml.indexOf("\non:"), yaml.indexOf("\npermissions:"));
  expect(on).toContain("cron: \"0 19 * * *\"");
  expect(on).toContain("workflow_dispatch:");
  expect(on).not.toMatch(/\bpush\b/);
  expect(on).not.toMatch(/\bpull_request/);
  expect(yaml).toContain("github.repository == 'tranthethang/agent-relay'");
  expect(yaml).toContain("runs-on: ubuntu-latest");
  expect(yaml).not.toMatch(/windows-latest|macos-latest/);
  expect(yaml).toContain("timeout-minutes: 120");
  expect(yaml).toMatch(/permissions:\n {2}contents: read/);
});

test("the model eval workflow passes secrets only in the eval step env", () => {
  const yaml = modelYaml();
  const steps = yaml.split("\n      - name: ").slice(1);
  const withSecrets = steps.filter((step) => step.includes("secrets."));
  expect(withSecrets).toHaveLength(1);
  expect(withSecrets[0]).toContain("Run model evals");
  expect(withSecrets[0]).toContain("env:");
  expect(yaml.match(/secrets\./g)).toHaveLength(2);
  expect(withSecrets[0]).toContain("secrets.ANTHROPIC_API_KEY");
  expect(withSecrets[0]).toContain("secrets.OPENAI_API_KEY");
});

test("the model eval workflow pins the agent CLIs and uploads the report", () => {
  const yaml = modelYaml();
  expect(yaml).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
  expect(yaml).toMatch(/@openai\/codex@\d+\.\d+\.\d+/);
  expect(yaml).toContain("npm run evals:model");
  expect(yaml).toContain("$GITHUB_STEP_SUMMARY");
  expect(yaml).toContain("path: model-report/");
});

test("ci.yml and the release workflow do not run the model evals", () => {
  for (const name of ["ci.yml", "release.yml", "codecov.yml"]) {
    const yaml = readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
    expect(yaml).not.toContain("evals:model");
  }
  const pkg = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  expect(pkg).toMatch(/"evals": "node --experimental-strip-types evals\/run\.ts"/);
});
