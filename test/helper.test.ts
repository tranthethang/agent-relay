import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { runCli, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

test("helper spawns the built CLI in a temporary git repo", async () => {
  await withTempGitRepo(async (dir) => {
    const inside = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: dir });
    expect(inside.stdout.trim()).toBe("true");
    const result = await runCli([], dir);
    expect(result.code).toBeTypeOf("number");
  });
});
