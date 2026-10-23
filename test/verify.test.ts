import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { distillVerifyText, verifyDistill } from "../src/core/distill.js";
import { gitCommit, runCli, withTempGitRepo } from "./helper.js";
import { createRun } from "./plan-helper.js";

const hash = "a".repeat(64);

test("atry distill verify checks a fresh manifest and names each difference", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-verify");
    await expect(verifyDistill(run)).rejects.toMatchObject({ message: "manifest not found" });
    const missingManifest = await runCli(["distill", "verify", run], dir);
    expect(missingManifest.code).toBe(3);

    await writeFile(join(run, "extra.txt"), "one\n");
    expect((await runCli(["distill", run], dir)).code).toBe(0);
    const manifestPath = join(run, "90-distill", "manifest.json");
    const fresh = await readFile(manifestPath, "utf8");

    const verified = await verifyDistill(run);
    expect(verified.ok).toBe(true);
    expect(distillVerifyText(verified)).toContain("ok: yes");
    const good = await runCli(["distill", "verify", run, "--json"], dir);
    expect(good.code).toBe(0);
    expect(JSON.parse(good.stdout)).toMatchObject({
      schema: 1,
      ok: true,
      missing: [],
      mismatched: [],
    });
    expect(await readFile(manifestPath, "utf8")).toBe(fresh);

    await writeFile(join(run, "extra.txt"), "two\n");
    expect((await verifyDistill(run)).mismatched).toEqual(["extra.txt"]);
    const changed = await runCli(["distill", "verify", run], dir);
    expect(changed.code).toBe(1);
    expect(changed.stdout).toContain("mismatched: extra.txt");
    expect(await readFile(manifestPath, "utf8")).toBe(fresh);

    await rm(join(run, "extra.txt"));
    const gone = await runCli(["distill", "verify", run], dir);
    expect(gone.code).toBe(1);
    expect(gone.stdout).toContain("missing: extra.txt");
    expect(await readFile(manifestPath, "utf8")).toBe(fresh);
  });
});

test("verify reports a size mismatch and a bad manifest", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-verify-size");
    await writeFile(join(run, "extra.txt"), "one\n");
    expect((await runCli(["distill", run, "--json"], dir)).code).toBe(0);
    const manifestPath = join(run, "90-distill", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files: { path: string; size: number; sha256: string }[];
    };
    const extra = manifest.files.find((file) => file.path === "extra.txt");
    expect(extra).toBeDefined();
    if (extra === undefined) return;
    extra.size = 0;
    const edited = `${JSON.stringify(manifest)}\n`;
    await writeFile(manifestPath, edited);
    const sized = await verifyDistill(run);
    expect(sized.ok).toBe(false);
    expect(sized.mismatched).toEqual(["extra.txt"]);
    expect(distillVerifyText(sized)).toContain("ok: no");
    expect(await readFile(manifestPath, "utf8")).toBe(edited);

    await writeFile(manifestPath, "[]\n");
    await expect(verifyDistill(run)).rejects.toMatchObject({
      fieldPath: "90-distill/manifest.json",
    });
    const invalid = await runCli(["distill", "verify", run], dir);
    expect(invalid.code).toBe(2);
    await writeFile(manifestPath, "{\"schema\":1}\n");
    await expect(verifyDistill(run)).rejects.toMatchObject({
      fieldPath: "90-distill/manifest.json:files",
    });

    await mkdir(join(run, "subdir"));
    await writeFile(
      manifestPath,
      `${JSON.stringify({ schema: 1, files: [{ path: "subdir", size: 0, sha256: hash }] })}\n`,
    );
    await expect(verifyDistill(run)).rejects.toThrow();
  });
});

test("verify reports files that the manifest does not name", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-verify-extra");
    expect((await runCli(["distill", run], dir)).code).toBe(0);

    const clean = await verifyDistill(run);
    expect(clean.ok).toBe(true);
    expect(clean.extra).toEqual([]);

    await mkdir(join(run, "90-distill"), { recursive: true });
    await writeFile(join(run, "notes.md"), "later\n");
    await writeFile(join(run, "90-distill", "manifest.old.json"), "{}\n");
    const extra = await verifyDistill(run);
    expect(extra.ok).toBe(false);
    expect(extra.extra).toEqual(["90-distill/manifest.old.json", "notes.md"]);
    expect(distillVerifyText(extra)).toContain("ok: no");
    expect(distillVerifyText(extra)).toContain("extra: notes.md");
    expect(distillVerifyText(extra)).not.toContain("extra: 90-distill/manifest.json");

    const cli = await runCli(["distill", "verify", run], dir);
    expect(cli.code).toBe(1);
    expect(cli.stdout).toContain("extra: notes.md");
    const json = await runCli(["distill", "verify", run, "--json"], dir);
    expect(json.code).toBe(1);
    expect(JSON.parse(json.stdout)).toMatchObject({
      schema: 1,
      ok: false,
      extra: ["90-distill/manifest.old.json", "notes.md"],
    });
  });
});

test("verify skips an unnamed test log and checks a named one", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const run = await createRun(dir, "distill-verify-logs");
    await mkdir(join(run, "30-self-review"), { recursive: true });
    await writeFile(join(run, "30-self-review", "01.test.log"), "one\n");
    expect((await runCli(["distill", run], dir)).code).toBe(0);

    const skipped = await verifyDistill(run);
    expect(skipped.ok).toBe(true);
    expect(skipped.extra).toEqual([]);

    expect((await runCli(["distill", run, "--include-test-logs"], dir)).code).toBe(0);
    await writeFile(join(run, "30-self-review", "01.test.log"), "two\n");
    await writeFile(join(run, "30-self-review", "02.test.log"), "new\n");
    const changed = await verifyDistill(run);
    expect(changed.ok).toBe(false);
    expect(changed.mismatched).toEqual(["30-self-review/01.test.log"]);
    expect(changed.extra).toEqual([]);
  });
});
