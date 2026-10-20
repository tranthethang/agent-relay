import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { parsePolicy, readPolicy } from "../src/core/policy.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

async function base(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
  return stdout.trim();
}

test("readPolicy uses defaults when the base has no policy", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    expect(await readPolicy(dir, await base(dir))).toEqual({
      schema: 1,
      requireReviews: ["self", "cross"],
      smallChange: 20,
      strict: { scope: false, plan: false, reviewIntegrity: false },
    });
  });
});

test("readPolicy reads a valid policy from the base", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["cross"],
        smallChange: 5,
        testCommand: "npm test",
        strict: { scope: false, plan: false, reviewIntegrity: false },
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    expect(await readPolicy(dir, await base(dir))).toEqual({
      schema: 1,
      requireReviews: ["cross"],
      smallChange: 5,
      testCommand: "npm test",
      strict: { scope: false, plan: false, reviewIntegrity: false },
    });
  });
});

test("readPolicy rejects invalid schema fields", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self", "self"],
        smallChange: -1,
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    await expect(readPolicy(dir, await base(dir))).rejects.toMatchObject(
      {
        code: "validation",
        fieldPath: ".agent-relay.json:requireReviews",
      } satisfies Partial<RelayError>,
    );
  });
});

test("readPolicy ignores a policy that exists only in the working tree", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const commit = await base(dir);
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
      }),
    );
    expect(await readPolicy(dir, commit)).toEqual({
      schema: 1,
      requireReviews: ["self", "cross"],
      smallChange: 20,
      strict: { scope: false, plan: false, reviewIntegrity: false },
    });
  });
});

async function commitPolicy(dir: string, value: unknown): Promise<string> {
  await writeFile(join(dir, ".agent-relay.json"), JSON.stringify(value));
  await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
  await gitCommit(dir);
  return base(dir);
}

test("readPolicy reads the worktree key from the base", async () => {
  await withTempGitRepo(async (dir) => {
    const commit = await commitPolicy(dir, {
      schema: 1,
      requireReviews: ["self"],
      smallChange: 0,
      worktree: { enabled: true, dir: "../wt" },
      strict: { scope: false, plan: false, reviewIntegrity: false },
    });
    expect(await readPolicy(dir, commit)).toEqual({
      schema: 1,
      requireReviews: ["self"],
      smallChange: 0,
      worktree: { enabled: true, dir: "../wt" },
      strict: { scope: false, plan: false, reviewIntegrity: false },
    });
  });
});

test("readPolicy rejects a worktree.enabled value that is not a boolean", async () => {
  await withTempGitRepo(async (dir) => {
    const commit = await commitPolicy(dir, {
      schema: 1,
      requireReviews: ["self"],
      smallChange: 0,
      worktree: { enabled: "yes" },
    });
    await expect(readPolicy(dir, commit)).rejects.toMatchObject(
      {
        code: "validation",
        fieldPath: ".agent-relay.json:worktree.enabled",
      } satisfies Partial<RelayError>,
    );
  });
});

test("parsePolicy rejects an unknown key in worktree", () => {
  const text = JSON.stringify({
    schema: 1,
    requireReviews: ["self"],
    smallChange: 0,
    worktree: { enabled: false, extra: 1 },
  });
  expect(() => parsePolicy(text)).toThrow(
    expect.objectContaining({ code: "validation", fieldPath: ".agent-relay.json:worktree" }),
  );
});

test("parsePolicy reports invalid JSON", () => {
  expect(() => parsePolicy("{")).toThrow(
    expect.objectContaining({
      code: "validation",
      message: "invalid JSON",
      fieldPath: ".agent-relay.json",
    }),
  );
});

test("parsePolicy defaults strict gate groups to false and accepts overrides", () => {
  const base = { schema: 1, requireReviews: ["self"], smallChange: 0 };
  expect(parsePolicy(JSON.stringify(base)).strict).toEqual({
    scope: false,
    plan: false,
    reviewIntegrity: false,
  });
  expect(parsePolicy(JSON.stringify({ ...base, strict: { scope: true } })).strict).toEqual({
    scope: true,
    plan: false,
    reviewIntegrity: false,
  });
});
