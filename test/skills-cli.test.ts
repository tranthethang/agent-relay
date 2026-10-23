import { Command } from "commander";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  bundledSkillNames,
  installSkills,
  parseSkillTool,
  registerSkills,
  skillsInstallText,
  skillsStatusText,
  statusSkills,
} from "../src/cli/skills.js";
import { runCli } from "./helper.js";

const names = [
  "atry-brainstorm",
  "atry-cross-review",
  "atry-distill",
  "atry-implement",
  "atry-plan",
  "atry-self-review",
];

type InstallBody = {
  schema: number;
  tool: string;
  dir: string;
  bundles: { name: string; path: string; status: string }[];
};

type StatusBody = {
  schema: number;
  installed: string;
  ok: boolean;
  dirs: { dir: string; bundles: { name: string; status: string; required?: string }[] }[];
};

async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "atry-skills-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function install(dir: string) {
  return runCli(["skills", "install", "--tool", "claude-code", "--dir", dir, "--json"], dir);
}

test("skills install writes six bundles into --dir", async () => {
  await withDir(async (dir) => {
    const result = await install(dir);
    expect(result.code, result.stderr).toBe(0);
    const body = JSON.parse(result.stdout) as InstallBody;
    expect(body.schema).toBe(1);
    expect(body.tool).toBe("claude-code");
    expect(body.dir).toBe(dir);
    expect(body.bundles.map((bundle) => bundle.name).sort()).toEqual(names);
    for (const bundle of body.bundles) {
      expect(bundle.status).toBe("installed");
      const skill = await readFile(join(dir, bundle.name, "SKILL.md"), "utf8");
      expect(skill).toContain(`name: ${bundle.name}`);
    }
  });
});

test("a second install reports every bundle as present and keeps a local file", async () => {
  await withDir(async (dir) => {
    expect((await install(dir)).code).toBe(0);
    const sentinel = join(dir, "atry-plan", "local.txt");
    await writeFile(sentinel, "keep\n");
    const again = await install(dir);
    expect(again.code, again.stderr).toBe(0);
    const body = JSON.parse(again.stdout) as InstallBody;
    expect(body.bundles.every((bundle) => bundle.status === "present")).toBe(true);
    expect(await readFile(sentinel, "utf8")).toBe("keep\n");
    const text = await runCli(["skills", "install", "--tool", "claude-code", "--dir", dir], dir);
    expect(text.stdout).toContain("installed: 0");
    expect(text.stdout).toContain("present: 6");
  });
});

test("skills status exits 0 when the installed floor matches the CLI", async () => {
  await withDir(async (dir) => {
    expect((await install(dir)).code).toBe(0);
    const result = await runCli(["skills", "status", "--dir", dir, "--json"], dir);
    expect(result.code, result.stderr).toBe(0);
    const body = JSON.parse(result.stdout) as StatusBody;
    expect(body.ok).toBe(true);
    expect(body.dirs).toHaveLength(1);
    expect(body.dirs[0]?.bundles.every((bundle) => bundle.status === "ok")).toBe(true);
    expect(body.installed).toMatch(/^\d+\.\d+\.\d+/);
  });
});

test("a higher requires-atry floor makes status exit 1 and print the install command", async () => {
  await withDir(async (dir) => {
    expect((await install(dir)).code).toBe(0);
    const skill = join(dir, "atry-plan", "SKILL.md");
    const text = await readFile(skill, "utf8");
    await writeFile(skill, text.replace(/^requires-atry: .*$/m, "requires-atry: \">=99.1.0\""));
    const result = await runCli(["skills", "status", "--dir", dir], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("atry-plan: mismatch");
    expect(result.stdout).toContain("npm i -g @tranthethang/agent-relay@latest");
  });
});

test("a missing bundle makes status exit 1", async () => {
  await withDir(async (dir) => {
    expect((await install(dir)).code).toBe(0);
    await rm(join(dir, "atry-distill"), { recursive: true, force: true });
    const result = await runCli(["skills", "status", "--dir", dir], dir);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("atry-distill: missing");
    expect(result.stdout).toContain("ok: no");
  });
});

test("an empty directory reports every bundle missing", async () => {
  await withDir(async (dir) => {
    const empty = join(dir, "empty");
    await mkdir(empty, { recursive: true });
    const result = await runCli(["skills", "status", "--dir", empty, "--json"], dir);
    expect(result.code).toBe(1);
    const body = JSON.parse(result.stdout) as StatusBody;
    expect(body.ok).toBe(false);
    expect(body.dirs[0]?.bundles.every((bundle) => bundle.status === "missing")).toBe(true);
  });
});

test("skills rejects an unknown tool before it writes a file", async () => {
  await withDir(async (dir) => {
    const result = await runCli(["skills", "install", "--tool", "vim", "--dir", dir], dir);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown tool: vim");
    const status = await runCli(["skills", "status", "--tool", "vim", "--dir", dir], dir);
    expect(status.code).not.toBe(0);
    expect(status.stderr).toContain("unknown tool: vim");
  });
});

test("skill helpers cover an empty bundle, a missing floor, and each directory choice", async () => {
  await withDir(async (dir) => {
    const source = join(dir, "bundles");
    await mkdir(join(source, "atry-plan"), { recursive: true });
    await writeFile(
      join(source, "atry-plan", "SKILL.md"),
      "name: atry-plan\nrequires-atry: \">=0.1.0\"\n",
    );
    await mkdir(join(dir, "empty"), { recursive: true });
    expect(() => bundledSkillNames(join(dir, "empty"))).toThrow("bundled skills are missing");
    const out = join(dir, "out");
    expect(installSkills({ tool: "claude-code", dir: out, root: source }).bundles[0]?.status).toBe(
      "installed",
    );
    expect(installSkills({ tool: "claude-code", dir: out, root: source }).bundles[0]?.status).toBe(
      "present",
    );
    const bare = join(dir, "bare");
    await mkdir(join(bare, "atry-plan"), { recursive: true });
    await writeFile(join(bare, "atry-plan", "SKILL.md"), "name: atry-plan\n");
    const mismatch = statusSkills({ dir: bare, root: source, installed: "1.2.3-dev" });
    expect(mismatch.ok).toBe(false);
    expect(skillsStatusText(mismatch)).toContain("install:");
    expect(statusSkills({ dir: bare, root: source, installed: "9.0.0" }).ok).toBe(false);
    expect(statusSkills({ tool: "cursor", root: source, installed: "9.0.0" }).dirs).toHaveLength(1);
    expect(statusSkills({ root: source, installed: "9.0.0" }).dirs.length).toBeGreaterThan(1);

    const parseStatus = async (args: string[]): Promise<void> => {
      const program = new Command();
      program.exitOverride();
      program.option("--json", "print JSON");
      registerSkills(program);
      await program.parseAsync(["skills", "status", ...args], { from: "user" });
    };
    await parseStatus(["--tool", "cursor", "--dir", bare]);
    await parseStatus(["--tool", "cursor"]);
  });
});

test("direct skill helpers handle valid, malformed, and pre-release version floors", async () => {
  await withDir(async (dir) => {
    const source = join(dir, "source");
    const skill = join(source, "atry-plan", "SKILL.md");
    await mkdir(join(source, "atry-plan"), { recursive: true });
    await writeFile(skill, "name: atry-plan\nrequires-atry: \">=1.2.0\"\n");
    expect(parseSkillTool(" cursor ")).toBe("cursor");
    expect(() => parseSkillTool("unknown")).toThrow("unknown tool");
    const installed = installSkills({ tool: "cursor", dir: join(dir, "installed"), root: source });
    expect(skillsInstallText(installed)).toContain("installed: 1\npresent: 0");
    expect(skillsInstallText(installSkills({ tool: "cursor", dir: installed.dir, root: source })))
      .toContain("installed: 0\npresent: 1");
    expect(statusSkills({ dir: installed.dir, root: source, installed: "1.2.1-dev" }).ok).toBe(
      true,
    );

    const copied = join(installed.dir, "atry-plan", "SKILL.md");
    await writeFile(copied, "name: atry-plan\nrequires-atry: \"not-a-range\"\n");
    const malformed = statusSkills({ dir: installed.dir, root: source, installed: "1.2.1" });
    expect(malformed.dirs[0]?.bundles[0]?.status).toBe("mismatch");
    expect(skillsStatusText(malformed)).toContain("(not-a-range)");
    await writeFile(copied, "name: atry-plan\nrequires-atry: \">=1.2.0\"\n");
    expect(statusSkills({ dir: installed.dir, root: source, installed: "1.2.1" }).ok).toBe(true);
  });
});

test("CLI uses isolated home defaults for install and status", async () => {
  await withDir(async (home) => {
    const cli = fileURLToPath(new URL("../dist/atry.js", import.meta.url));
    const isolated = (args: string[]): Promise<{ code: number; stdout: string; stderr: string }> =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cli, ...args], {
          cwd: home,
          env: { ...process.env, HOME: home, USERPROFILE: home },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => stdout += chunk);
        child.stderr.on("data", (chunk: string) => stderr += chunk);
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
      });
    const installed = await isolated(["skills", "install", "--tool", "cursor", "--json"]);
    expect(installed.code, installed.stderr).toBe(0);
    expect(JSON.parse(installed.stdout).dir).toBe(join(home, ".agents", "skills"));
    const missing = await isolated(["skills", "status", "--tool", "kiro", "--json"]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).ok).toBe(false);
    const all = await isolated(["skills", "status", "--json"]);
    expect(all.code).toBe(1);
    expect(JSON.parse(all.stdout).dirs.length).toBeGreaterThan(1);
  });
});
