import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { readOwner } from "../src/core/lock.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

async function staleLock(run: string, task: string, session: string): Promise<void> {
  await mkdir(join(run, "locks"), { recursive: true });
  await writeFile(
    join(run, "locks", `${task}.lock`),
    `${
      JSON.stringify({
        schema: 1,
        session,
        pid: 1,
        host: "test",
        ts: new Date(Date.now() - 120_000).toISOString(),
      })
    }\n`,
  );
}

test("steal keeps an existing guard and removes its own", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "steal-guard");
    await writeTasks(run, [{ title: "First", files: ["src/core/claim.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    const guard = join(run, "locks", "T1.steal");
    await writeFile(guard, "keep\n");
    const refused = await runCli(["steal", run, "T1", "--session", "bob", "--ttl", "0"], dir);
    expect(refused.code).toBe(5);
    expect(refused.stderr).toContain("locks/T1.steal");
    expect(await readFile(guard, "utf8")).toBe("keep\n");
    expect((await readOwner(run, "T1")).session).toBe("alice");

    await rm(guard);
    const stolen = await runCli(["steal", run, "T1", "--session", "bob", "--ttl", "0"], dir);
    expect(stolen.code).toBe(0);
    await expect(access(guard)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readOwner(run, "T1")).session).toBe("bob");
  });
});

test("steal refuses an overlap and removes the guard", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "steal-overlap");
    await writeTasks(run, [
      { title: "Held", files: ["src/core"] },
      { title: "Taken", files: ["src/core/claim.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    await staleLock(run, "T2", "carol");
    const refused = await runCli(["steal", run, "T2", "--session", "bob", "--ttl", "1"], dir);
    expect(refused.code).toBe(5);
    expect(refused.stderr).toContain("T2.files: overlaps T1");
    await expect(access(join(run, "locks", "T2.steal"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readOwner(run, "T2")).session).toBe("carol");
  });
});

test("two concurrent steals and one wins", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "steal-race");
    await writeTasks(run, [{ title: "Only", files: ["src/core/claim.ts"] }]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    await staleLock(run, "T1", "alice");
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        (_, index) => runCli(["steal", run, "T1", "--session", `s${index}`, "--ttl", "1"], dir),
      ),
    );
    const wins = results.filter((result) => result.code === 0);
    expect(wins).toHaveLength(1);
    expect(results.filter((result) => result.code !== 0).every((result) => result.code === 5))
      .toBe(true);
    expect((await readOwner(run, "T1")).session).toBe(
      /session: (\S+)/.exec(wins[0]?.stdout ?? "")?.[1],
    );
    await expect(access(join(run, "locks", "T1.steal"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
