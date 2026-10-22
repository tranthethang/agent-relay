import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
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
