import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { normalizePath, overlappingTask, pathsOverlap } from "../src/core/overlap.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun, startImplement, writeTasks } from "./plan-helper.js";

test("normalizePath compares equal paths and directory prefixes", () => {
  expect(normalizePath("./src/core/")).toBe("src/core");
  expect(normalizePath("src\\core\\claim.ts")).toBe("src/core/claim.ts");
  expect(pathsOverlap("src/core", "src/core/claim.ts")).toBe(true);
  expect(pathsOverlap("src/core/claim.ts", "src/core/claim.ts")).toBe(true);
  expect(pathsOverlap("src/foo", "src/foobar")).toBe(false);
  expect(normalizePath("src/../src/core/plan.ts")).toBe("src/core/plan.ts");
  expect(() => normalizePath(".")).toThrow(RelayError);
  expect(() => normalizePath("./")).toThrow(RelayError);
  expect(() => normalizePath("")).toThrow(RelayError);
  expect(() => normalizePath("../outside")).toThrow(RelayError);
  expect(() => normalizePath("/x")).toThrow(RelayError);
  expect(() => normalizePath("C:\\x")).toThrow(RelayError);
  const tasks = [
    { id: "T1", title: "A", deps: [], files: ["src/core/claim.ts"], path: "10-plan/T1.md" },
    { id: "T2", title: "B", deps: [], files: ["src/core"], path: "10-plan/T2.md" },
    { id: "T3", title: "C", deps: [], files: ["src/cli/plan.ts"], path: "10-plan/T3.md" },
  ];
  expect(overlappingTask(tasks, "T2", new Set(["T1"]))).toBe("T1");
  expect(overlappingTask(tasks, "T3", new Set(["T1"]))).toBe(null);
});

test("claim refuses a file overlap with another session and exits 5", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-overlap");
    await writeTasks(run, [
      { title: "Core file", files: ["src/core/claim.ts"] },
      { title: "Core dir", files: ["src/core"] },
      { title: "Cli", files: ["src/cli/plan.ts"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    expect((await runCli(["claim", run, "T1", "--session", "alice"], dir)).code).toBe(0);
    const overlap = await runCli(["claim", run, "T2", "--session", "bob"], dir);
    expect(overlap.code).toBe(5);
    expect(overlap.stderr).toContain("T2.files: overlaps T1");
    await expect(access(join(run, "locks", "T2.lock"))).rejects.toMatchObject({ code: "ENOENT" });
    const same = await runCli(["claim", run, "T2", "--session", "alice"], dir);
    expect(same.code).toBe(0);
    expect((await runCli(["claim", run, "T3", "--session", "bob"], dir)).code).toBe(0);
  });
});

test("claim treats an unreadable lock of an overlapping task as held", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "claim-overlap-empty");
    await writeTasks(run, [
      { title: "Core file", files: ["src/core/claim.ts"] },
      { title: "Core dir", files: ["src/core"] },
    ]);
    expect((await runCli(["plan", "done", run], dir)).code).toBe(0);
    await startImplement(dir, run);
    // acquireLock opens with wx before it writes the body, so a reader can see an empty file.
    await mkdir(join(run, "locks"), { recursive: true });
    await writeFile(join(run, "locks", "T1.lock"), "");
    const overlap = await runCli(["claim", run, "T2", "--session", "bob"], dir);
    expect(overlap.code).toBe(5);
    expect(overlap.stderr).toContain("T2.files: overlaps T1");
    await expect(access(join(run, "locks", "T2.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
