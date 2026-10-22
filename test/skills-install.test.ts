import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repo = fileURLToPath(new URL("..", import.meta.url));
const agents = ["cursor", "claude-code", "codex", "antigravity", "kiro-cli"] as const;
const agentNames = ["Cursor", "Claude Code", "Codex", "Antigravity", "Kiro CLI"];

type InstallRow = {
  name: string;
  status: string;
  path: string;
  mode: string;
  agents: string[];
};

test("npx skills add copies skills for five agents into a temporary HOME", async () => {
  const parent = join(repo, ".tmp-test");
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(join(parent, "skills-home-"));
  try {
    const { code, stdout, stderr } = await runSkills(home);
    expect(code, stderr).toBe(0);
    const rows = JSON.parse(jsonBody(stdout)) as InstallRow[];
    expect(rows.map((row) => row.name).sort()).toEqual([
      "atry-brainstorm",
      "atry-cross-review",
      "atry-distill",
      "atry-implement",
      "atry-plan",
      "atry-self-review",
    ]);
    for (const row of rows) {
      expect(row.status).toBe("installed");
      expect(row.mode).toBe("copy");
      expect(row.agents).toEqual(agentNames);
      const skill = await readFile(join(row.path, "SKILL.md"), "utf8");
      expect(skill.length).toBeGreaterThan(0);
      expect((await lstat(join(row.path, "SKILL.md"))).isSymbolicLink()).toBe(false);
    }
    for (const root of [".agents/skills", ".claude/skills", ".kiro/skills"]) {
      const skill = await readFile(join(home, root, "atry-plan", "SKILL.md"), "utf8");
      expect(skill).toContain("name: atry-plan");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120_000);

test("the npm package lists skills and the six bundles are in the repo", async () => {
  const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8")) as {
    files?: string[];
  };
  expect(pkg.files).toContain("skills");
  for (
    const name of [
      "atry-brainstorm",
      "atry-cross-review",
      "atry-distill",
      "atry-implement",
      "atry-plan",
      "atry-self-review",
    ]
  ) {
    const skill = await readFile(join(repo, "skills", name, "SKILL.md"), "utf8");
    expect(skill).toContain(`name: ${name}`);
  }
});

function skillEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.HOMEDRIVE;
  delete env.HOMEPATH;
  return env;
}

function runSkills(home: string): Promise<{ code: number; stdout: string; stderr: string }> {
  // Node refuses to spawn a .cmd file without a shell (EINVAL), so Windows goes
  // through cmd.exe. Quote the repo path and drop its trailing separator so the
  // closing quote is not escaped.
  const win = process.platform === "win32";
  const npx = win ? "npx.cmd" : "npx";
  const repoArg = win ? `"${repo.replace(/[\\/]+$/, "")}"` : repo;
  return new Promise((resolve, reject) => {
    const child = spawn(
      npx,
      ["--yes", "skills@1.7.2", "add", repoArg, "-g", "--copy", "-y", "--json", "-a", ...agents],
      {
        cwd: tmpdir(),
        env: skillEnv(home),
        shell: win,
      },
    );
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
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function jsonBody(stdout: string): string {
  const start = stdout.indexOf("[");
  if (start < 0) throw new Error(stdout);
  return stdout.slice(start);
}
