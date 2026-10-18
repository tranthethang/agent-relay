import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("guard allows an in-progress task path and refuses the rest", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "guard-path");
    await writeTasks(run, [
      { title: "Own", files: ["src/own.ts"] },
      { title: "Peer", files: ["src/peer.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    expect((await runCli(["claim", run, "T2", "--session", "bob"], dir)).code).toBe(0);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/own.ts"), "export {};\n");

    const allowed = await runCli(["guard", run, "src/own.ts", "--session", "alice", "--json"], dir);
    expect(allowed.code).toBe(0);
    expect(JSON.parse(allowed.stdout)).toMatchObject({ allowed: true, task: "T1" });

    const windows = await runCli(["guard", run, "src\\own.ts", "--session", "alice"], dir);
    expect(windows.code).toBe(0);
    expect(windows.stdout).toContain("allowed: yes");

    const wrong = await runCli(["guard", run, "src/own.ts", "--session", "bob", "--json"], dir);
    expect(wrong.code).toBe(4);
    expect(JSON.parse(wrong.stdout)).toMatchObject({ allowed: false, task: null });

    const refused = await runCli(["guard", run, "src/missing.ts", "--json"], dir);
    expect(refused.code).toBe(4);
    expect(JSON.parse(refused.stdout)).toMatchObject({ allowed: false, task: null });

    const outside = await runCli(["guard", run, "/tmp/outside.ts", "--json"], dir);
    expect(outside.code).toBe(4);
    expect(JSON.parse(outside.stdout)).toMatchObject({ allowed: false, task: null });

    const runFile = await runCli(["guard", run, join(run, "events.jsonl"), "--json"], dir);
    expect(runFile.code).toBe(0);
    expect(JSON.parse(runFile.stdout)).toMatchObject({ allowed: true, task: null });
  });
});
