import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

test("atry distill writes sha256 entries and appends no event", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-run");
    const before = await readFile(join(run, "events.jsonl"), "utf8");
    const created = await runCli(["distill", run, "--json"], dir);
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as { path: string; files: number };
    expect(body.path).toBe(join(run, "90-distill", "manifest.json"));
    const manifest = JSON.parse(await readFile(body.path, "utf8")) as {
      schema: number;
      files: { path: string; size: number; sha256: string }[];
    };
    expect(manifest.schema).toBe(1);
    expect(body.files).toBe(manifest.files.length);
    expect(manifest.files.some((file) => file.path === "90-distill/manifest.json")).toBe(false);
    const events = manifest.files.find((file) => file.path === "events.jsonl");
    const raw = await readFile(join(run, "events.jsonl"));
    expect(events).toEqual({
      path: "events.jsonl",
      size: raw.byteLength,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
    const paths = manifest.files.map((file) => file.path);
    expect(paths).toEqual([...paths].sort());
    expect(await readFile(join(run, "events.jsonl"), "utf8")).toBe(before);
    const again = await runCli(["distill", run], dir);
    expect(again.code).toBe(0);
    expect(await readFile(join(run, "events.jsonl"), "utf8")).toBe(before);
  });
});

test("atry distill skips locks and temp files", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-skip");
    const first = await runCli(["distill", run, "--json"], dir);
    expect(first.code).toBe(0);
    const before = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    await mkdir(join(run, "locks"), { recursive: true });
    await writeFile(join(run, "locks", "T1.lock"), "lock\n");
    await writeFile(join(run, ".events.jsonl.abcd.tmp"), "tmp\n");
    await writeFile(join(run, "extra.txt"), "keep\n");
    const second = await runCli(["distill", run, "--json"], dir);
    expect(second.code).toBe(0);
    const after = JSON.parse(
      await readFile(join(run, "90-distill", "manifest.json"), "utf8"),
    ) as { files: { path: string }[] };
    const paths = after.files.map((file) => file.path);
    expect(paths.some((path) => path.startsWith("locks/"))).toBe(false);
    expect(paths.some((path) => path.endsWith(".tmp"))).toBe(false);
    expect(paths).toEqual([...before.files.map((file) => file.path), "extra.txt"].sort());
  });
});

test("atry distill works after the run is abandoned", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-closed");
    const abandoned = await runCli(["close", run, "--abandon", "stop"], dir);
    expect(abandoned.code).toBe(0);
    const created = await runCli(["distill", run, "--json"], dir);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout).files).toBeGreaterThan(0);
  });
});
