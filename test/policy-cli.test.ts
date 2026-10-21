import { execFile } from "node:child_process";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { initPolicy, policyPresets, policyTemplate } from "../src/core/policy.js";
import { runCli, withTempDir, withTempGitRepo } from "./helper.js";

const execFileAsync = promisify(execFile);

test("policy init writes the template at the git root", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["policy", "init"], dir);
    expect(result.code).toBe(0);
    const text = await readFile(join(dir, ".agent-relay.json"), "utf8");
    expect(JSON.parse(text)).toEqual(policyTemplate);
    expect(policyTemplate.strict).toEqual({ scope: false, plan: false, reviewIntegrity: false });
    expect(text.endsWith("}\n")).toBe(true);
    expect(result.stdout).toContain("commit the file to apply it");
  });
});

test("policy init refuses when the file exists and keeps it", async () => {
  await withTempGitRepo(async (dir) => {
    expect((await runCli(["policy", "init"], dir)).code).toBe(0);
    const path = join(dir, ".agent-relay.json");
    await writeFile(path, "{\"keep\":true}\n");
    const result = await runCli(["policy", "init"], dir);
    expect(result.code).toBe(4);
    expect(await readFile(path, "utf8")).toBe("{\"keep\":true}\n");
  });
});

test("policy init from a subdirectory writes at the git root", async () => {
  await withTempGitRepo(async (dir) => {
    const sub = join(dir, "a", "b");
    await mkdir(sub, { recursive: true });
    expect((await runCli(["policy", "init"], sub)).code).toBe(0);
    expect(JSON.parse(await readFile(join(dir, ".agent-relay.json"), "utf8"))).toEqual(
      policyTemplate,
    );
  });
});

test("policy check passes on the file that init writes", async () => {
  await withTempGitRepo(async (dir) => {
    await runCli(["policy", "init"], dir);
    const result = await runCli(["policy", "check"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/^ok: .*\.agent-relay\.json\n$/);
  });
});

test("policy check reports not_found when the file is missing", async () => {
  await withTempGitRepo(async (dir) => {
    const result = await runCli(["policy", "check"], dir);
    expect(result.code).toBe(3);
  });
});

test("policy check reports the field path of a wrong type", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        worktree: { enabled: "yes" },
      }),
    );
    const result = await runCli(["policy", "check", "--json"], dir);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "validation", path: ".agent-relay.json:worktree.enabled" },
    });
  });
});

test("policy init does not stage the file", async () => {
  await withTempGitRepo(async (dir) => {
    await runCli(["policy", "init"], dir);
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: dir });
    expect(stdout).toBe("?? .agent-relay.json\n");
  });
});

test("policy check rejects worktree.dir inside the repository", async () => {
  await withTempGitRepo(async (dir) => {
    for (const target of [".", "./worktrees", "sub/dir", join(dir, "abs-inside")]) {
      await writeFile(
        join(dir, ".agent-relay.json"),
        JSON.stringify({
          schema: 1,
          requireReviews: ["self"],
          smallChange: 0,
          worktree: { enabled: true, dir: target },
        }),
      );
      const result = await runCli(["policy", "check", "--json"], dir);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: "validation", path: ".agent-relay.json:worktree.dir" },
      });
    }
  });
});

test("policy check rejects worktree.dir inside repo when enabled is false", async () => {
  await withTempGitRepo(async (dir) => {
    await writeFile(
      join(dir, ".agent-relay.json"),
      JSON.stringify({
        schema: 1,
        requireReviews: ["self"],
        smallChange: 0,
        worktree: { enabled: false, dir: "./inside" },
      }),
    );
    const result = await runCli(["policy", "check", "--json"], dir);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "validation", path: ".agent-relay.json:worktree.dir" },
    });
  });
});

test("policy check rejects a symlink into the repository as worktree.dir", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (outside) => {
      const symlinkPath = join(outside, "link-to-repo");
      await symlink(repo, symlinkPath, process.platform === "win32" ? "junction" : "dir");
      await writeFile(
        join(repo, ".agent-relay.json"),
        JSON.stringify({
          schema: 1,
          requireReviews: ["self"],
          smallChange: 0,
          worktree: { enabled: true, dir: symlinkPath },
        }),
      );
      const result = await runCli(["policy", "check", "--json"], repo);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stderr)).toMatchObject({
        error: { code: "validation", path: ".agent-relay.json:worktree.dir" },
      });
    });
  });
});

test("policy check accepts valid outside worktree.dir and symlink pointing outside", async () => {
  await withTempGitRepo(async (repo) => {
    await withTempDir(async (outside) => {
      // 1. relative outside
      await writeFile(
        join(repo, ".agent-relay.json"),
        JSON.stringify({
          schema: 1,
          requireReviews: ["self"],
          smallChange: 0,
          worktree: { enabled: true, dir: "../outside-wt" },
        }),
      );
      expect((await runCli(["policy", "check"], repo)).code).toBe(0);

      // 2. symlink inside repo pointing outside
      const linkInside = join(repo, "link-out");
      await symlink(outside, linkInside, process.platform === "win32" ? "junction" : "dir");
      await writeFile(
        join(repo, ".agent-relay.json"),
        JSON.stringify({
          schema: 1,
          requireReviews: ["self"],
          smallChange: 0,
          worktree: { enabled: true, dir: "link-out/sub" },
        }),
      );
      expect((await runCli(["policy", "check"], repo)).code).toBe(0);
    });
  });
});

test("policy init writes each preset and each one passes policy check", async () => {
  for (const preset of ["lenient", "standard", "strict"] as const) {
    await withTempGitRepo(async (dir) => {
      const result = await runCli(["policy", "init", "--preset", preset, "--json"], dir);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ schema: 1, preset });
      const written = JSON.parse(await readFile(join(dir, ".agent-relay.json"), "utf8")) as unknown;
      expect(written).toEqual(policyPresets[preset]);
      expect((await runCli(["policy", "check"], dir)).code).toBe(0);
    });
  }
  expect(policyTemplate).toEqual(policyPresets.standard);
  expect(policyPresets.lenient).toMatchObject({ requireReviews: ["self"], smallChange: 100 });
  expect(policyPresets.strict.strict).toEqual({ scope: true, plan: true, reviewIntegrity: true });
});

test("policy init names the default preset and refuses an unknown one", async () => {
  await withTempGitRepo(async (dir) => {
    const unknown = await runCli(["policy", "init", "--preset", "loose"], dir);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("preset: preset must be lenient, standard, or strict");
    await expect(initPolicy(dir, "toString")).rejects.toThrow("preset must be");
    const result = await runCli(["policy", "init"], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("preset: standard");
  });
});
