import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  doctorReport,
  doctorText,
  gitCheck,
  installedSkillsCheck,
  nodeCheck,
  pathCheck,
  policyCheck,
  skillsCheck,
  versionCheck,
} from "../src/core/doctor.js";
import type { SkillsStatusResult } from "../src/core/skills.js";
import { cliPath, type CliResult, withTempDir, withTempGitRepo } from "./helper.js";

const skillsRoot = fileURLToPath(new URL("../skills", import.meta.url));
const builtVersion = (JSON.parse(
  readFileSync(new URL("../dist/package.json", import.meta.url), "utf8"),
) as { version: string }).version;

function runDoctor(cwd: string, env: NodeJS.ProcessEnv, args = ["doctor"]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function pathEnv(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: dir };
  if (process.platform === "win32") env.Path = dir;
  return env;
}

function statusOf(status: "ok" | "stale" | "missing" | "mismatch"): SkillsStatusResult {
  return {
    schema: 1,
    installed: "0.10.7",
    required: ">=0.10.7",
    ok: status === "ok",
    dirs: [
      {
        dir: "/skills",
        bundles: [{ name: "atry-plan", path: "/skills/atry-plan", status, required: ">=0.10.7" }],
      },
    ],
  };
}

test("node and version checks accept the supported range", () => {
  expect(nodeCheck("22.0.0")).toMatchObject({ ok: true, detail: "v22.0.0" });
  expect(nodeCheck("24.18.0").ok).toBe(true);
  expect(nodeCheck("21.9.0").ok).toBe(false);
  expect(nodeCheck("nope").ok).toBe(false);
  expect(versionCheck("0.0.0").ok).toBe(true);
  expect(versionCheck("0.10.7-dev").ok).toBe(true);
  expect(versionCheck("1.2").ok).toBe(false);
  expect(versionCheck("").ok).toBe(false);
});

test("git, skills, and policy checks report each failure", async () => {
  expect((await gitCheck(async () => "git version 2\n")).detail).toBe("git version 2");
  expect((await gitCheck(async () => "git version 2\nextra\n")).detail).toBe("git version 2");
  expect((await gitCheck(async () => "\n")).detail).toBe("git");
  expect(
    (await gitCheck(async () => {
      throw new Error("missing");
    })).ok,
  ).toBe(false);

  expect(skillsCheck(skillsRoot).ok).toBe(true);
  expect(skillsCheck().ok).toBe(true);
  await withTempDir(async (dir) => {
    expect(skillsCheck(dir)).toMatchObject({
      ok: false,
      detail: "bundled skills are missing",
    });
    expect(skillsCheck(join(dir, "missing")).detail).toBe("bundled skills are missing");
    await withTempGitRepo(async (repo) => {
      expect(await policyCheck(repo)).toMatchObject({ ok: true, detail: "default" });
      await writeFile(join(repo, ".agent-relay.json"), "{", "utf8");
      expect((await policyCheck(repo)).ok).toBe(false);
    });
    expect(
      await policyCheck(dir, async () => {
        throw "x";
      }),
    ).toMatchObject({ ok: false, detail: "policy check failed" });
    expect(await policyCheck(dir, async () => ({ path: "policy.json" }))).toMatchObject({
      ok: true,
      detail: "policy.json",
    });
  });
});

test("path check finds atry and ignores a directory", async () => {
  await withTempDir(async (dir) => {
    expect(pathCheck({ PATH: dir }, "linux").ok).toBe(false);
    expect(pathCheck({}, "linux").ok).toBe(false);
    expect(pathCheck({}, "win32").ok).toBe(false);
    expect(pathCheck({ OTHER: "x", PATH: undefined }, "win32").ok).toBe(false);
    await mkdir(join(dir, "atry"));
    expect(pathCheck({ PATH: dir }, "linux").ok).toBe(false);
    await writeFile(join(dir, "atry.exe"), "");
    expect(pathCheck({ PATH: `${delimiter}${dir}` }, "win32")).toMatchObject({
      ok: true,
      detail: "atry",
    });
  });
});

test("path check accepts a later windows suffix", async () => {
  await withTempDir(async (dir) => {
    const cmd = join(dir, "cmd");
    await mkdir(cmd);
    await writeFile(join(cmd, "atry.cmd"), "");
    expect(pathCheck({ Path: cmd }, "win32").ok).toBe(true);
    const bat = join(dir, "bat");
    await mkdir(bat);
    await writeFile(join(bat, "atry.bat"), "");
    expect(pathCheck({ PATH: bat }, "win32").ok).toBe(true);
    const plain = join(dir, "plain");
    await mkdir(plain);
    await writeFile(join(plain, "atry"), "");
    expect(pathCheck({ PATH: plain }, "win32").ok).toBe(true);
  });
});

test("installed skills check reports ok, stale, and no directory", () => {
  expect(installedSkillsCheck({ installedSkills: () => statusOf("ok") })).toMatchObject({
    ok: true,
    detail: "1 ok",
  });
  expect(installedSkillsCheck({ installedSkills: () => statusOf("stale") })).toMatchObject({
    ok: false,
    detail: "atry-plan stale",
  });
  expect(installedSkillsCheck({ installedSkills: () => statusOf("missing") })).toMatchObject({
    ok: false,
    detail: "atry-plan missing",
  });
  expect(
    installedSkillsCheck({
      installedSkills: () => ({ ...statusOf("ok"), dirs: [] }),
    }),
  ).toMatchObject({ ok: false, detail: "no tool skill directory" });
  expect(
    installedSkillsCheck({
      installedSkills: () => {
        throw new Error("installed skills are missing");
      },
    }),
  ).toMatchObject({ ok: false, detail: "installed skills are missing" });
});

test("doctorReport fails a closed check and passes a healthy checkout", async () => {
  await withTempGitRepo(async (dir) => {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "atry"), "");
    const healthy = await doctorReport({
      cwd: dir,
      env: { PATH: bin },
      platform: "linux",
      nodeVersion: "22.0.0",
      cliVersion: "0.10.7",
      skillsRoot,
      installedSkills: () => statusOf("ok"),
      pathVersion: async () => "0.10.7\n",
    });
    expect(healthy.ok).toBe(true);
    expect(healthy.checks.map((check) => check.name)).toEqual([
      "node",
      "git",
      "version",
      "skills",
      "installed-skills",
      "policy",
      "path",
      "path-version",
    ]);
    expect(doctorText(healthy)).toContain("node: ok v22.0.0");
    expect(doctorText(healthy)).toContain("skills: ok bundled: 6");
    expect(doctorText(healthy)).toContain("path-version: ok path 0.10.7, running 0.10.7");

    const stale = await doctorReport({
      cwd: dir,
      env: { PATH: bin },
      platform: "linux",
      nodeVersion: "22.0.0",
      cliVersion: "0.10.7",
      skillsRoot,
      installedSkills: () => statusOf("stale"),
      pathVersion: async () => "0.10.7\n",
    });
    expect(stale.ok).toBe(false);
    expect(doctorText(stale)).toContain("installed-skills: fail atry-plan stale");

    const older = await doctorReport({
      cwd: dir,
      env: { PATH: bin },
      platform: "linux",
      nodeVersion: "22.0.0",
      cliVersion: "0.10.7",
      skillsRoot,
      installedSkills: () => statusOf("ok"),
      pathVersion: async () => "0.10.6\n",
    });
    expect(older.ok).toBe(false);
    expect(doctorText(older)).toContain("path-version: fail PATH atry is 0.10.6, running 0.10.7");

    const noDirs = await doctorReport({
      cwd: dir,
      env: { PATH: bin },
      platform: "linux",
      nodeVersion: "22.0.0",
      cliVersion: "0.10.7",
      skillsRoot,
      installedSkills: () => ({ ...statusOf("ok"), dirs: [] }),
      pathVersion: async () => "0.10.7\n",
    });
    expect(doctorText(noDirs)).toContain("installed-skills: fail no tool skill directory");

    const failed = await doctorReport({
      cwd: dir,
      env: { PATH: join(dir, "missing") },
      platform: "linux",
      nodeVersion: "20.0.0",
      readVersion: () => {
        throw new Error("missing");
      },
      skillsRoot: join(dir, "no-skills"),
      gitText: async () => {
        throw new Error("no git");
      },
      loadPolicy: async () => {
        throw new Error("bad policy");
      },
      installedSkills: () => {
        throw new Error("no installed skills");
      },
    });
    expect(failed.ok).toBe(false);
    expect(doctorText(failed)).toContain("version: fail CLI version is missing");
    expect(doctorText(failed)).toContain("installed-skills: fail no installed skills");
    expect(doctorText(failed)).toContain("path: fail atry is missing from PATH");
    expect(doctorText(failed)).toContain("path-version: fail atry is missing from PATH");
  });
});

test("atry doctor exits 0 on a healthy checkout", async () => {
  await withTempGitRepo(async (dir) => {
    const home = join(dir, "home");
    const bin = join(dir, "bin");
    await mkdir(home);
    await mkdir(bin);
    const name = process.platform === "win32" ? "atry.cmd" : "atry";
    const shim = join(bin, name);
    const body = process.platform === "win32"
      ? `@echo off\r\necho ${builtVersion}\r\n`
      : `#!/bin/sh\necho ${builtVersion}\n`;
    await writeFile(shim, body);
    if (process.platform !== "win32") await chmod(shim, 0o755);
    const env = { ...pathEnv(bin), HOME: home, USERPROFILE: home };

    const install = await runDoctor(dir, env, ["skills", "install", "--tool", "cursor", "--json"]);
    expect(install.code, install.stderr).toBe(0);

    const result = await runDoctor(dir, env);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("installed-skills: ok 6 ok");
    expect(result.stdout).toContain("policy: ok default");
    expect(result.stdout).toContain("path: ok atry");
    expect(result.stdout).toContain(
      `path-version: ok path ${builtVersion}, running ${builtVersion}`,
    );
    const json = await runDoctor(dir, env, ["doctor", "--json"]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({ schema: 1, ok: true });
  });
});

test("atry doctor exits 1 when atry is missing from PATH", async () => {
  await withTempGitRepo(async (dir) => {
    const bin = join(dir, "empty-bin");
    const home = join(dir, "home");
    await mkdir(bin);
    await mkdir(home);
    const env = { ...pathEnv(bin), HOME: home, USERPROFILE: home };
    const result = await runDoctor(dir, env);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("path: fail atry is missing from PATH");
    expect(result.stdout).toContain("path-version: fail atry is missing from PATH");
  });
});
