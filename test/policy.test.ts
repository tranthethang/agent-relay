import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { readPolicy } from "../src/core/policy.js";
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
      }),
    );
    await execFileAsync("git", ["add", ".agent-relay.json"], { cwd: dir });
    await gitCommit(dir);
    expect(await readPolicy(dir, await base(dir))).toEqual({
      schema: 1,
      requireReviews: ["cross"],
      smallChange: 5,
      testCommand: "npm test",
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
    });
  });
});
