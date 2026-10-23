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
