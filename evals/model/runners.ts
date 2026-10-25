import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { appendFile, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { cliPath } from "./fixtures.ts";

export type RunResult = {
  exit: number | null;
  timedOut: boolean;
  ms: number;
};

export type Runner = {
  tool: "claude-code" | "codex";
  available: () => boolean;
  run: (prompt: string, cwd: string, timeoutMs: number) => Promise<RunResult>;
};

export type RunnerOptions = {
  env?: NodeJS.ProcessEnv;
  maxTurns?: number;
};

const claudeTools = [
  "Skill",
  "Read",
  "Edit",
  "Write",
  "Bash(atry:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git add:*)",
  "Bash(git commit:*)",
];

function onPath(binary: string, env: NodeJS.ProcessEnv): boolean {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir === "") continue;
    try {
      accessSync(join(dir, binary), constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

// A temp `atry` that loads this checkout's build, so the agent never runs another install.
async function writeShim(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "atry-shim-"));
  const file = join(dir, "atry");
  await writeFile(
    file,
    `#!/usr/bin/env node\nimport(${JSON.stringify(pathToFileURL(cliPath).href)});\n`,
  );
  await chmod(file, 0o755);
  return dir;
}

function execNode(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { cwd, env, stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`atry ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

// The installed skills stay out of `git status`, so a clean-tree check sees only the agent's edits.
async function installSkills(
  tool: "claude-code" | "codex",
  relDir: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await execNode(["skills", "install", "--tool", tool, "--dir", join(cwd, relDir)], cwd, env);
  await appendFile(join(cwd, ".git", "info", "exclude"), `/${relDir}/\n`);
}

function spawnWithTimeout(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // An ignored stdin keeps the agent from waiting for input.
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "ignore", "ignore"] });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const finish = (exit: number | null) => {
      clearTimeout(timer);
      resolve({ exit, timedOut, ms: Date.now() - started });
    };
    child.on("error", () => finish(null));
    child.on("close", (code) => finish(code));
  });
}

async function runWithShim(
  options: RunnerOptions,
  tool: "claude-code" | "codex",
  relDir: string,
  command: (prompt: string) => { binary: string; args: string[] },
  prompt: string,
  cwd: string,
  timeoutMs: number,
): Promise<RunResult> {
  const base = options.env ?? process.env;
  const shim = await writeShim();
  try {
    const env: NodeJS.ProcessEnv = {
      ...base,
      ATRY_DEV: "1",
      PATH: `${shim}${delimiter}${base.PATH ?? ""}`,
    };
    await installSkills(tool, relDir, cwd, env);
    const { binary, args } = command(prompt);
    return await spawnWithTimeout(binary, args, cwd, env, timeoutMs);
  } finally {
    await rm(shim, { recursive: true, force: true });
  }
}

export function createRunners(options: RunnerOptions = {}): Runner[] {
  const env = () => options.env ?? process.env;
  const maxTurns = options.maxTurns ?? 40;
  return [
    {
      tool: "claude-code",
      available: () => onPath("claude", env()) && (env().ANTHROPIC_API_KEY ?? "") !== "",
      run: (prompt, cwd, timeoutMs) =>
        runWithShim(
          options,
          "claude-code",
          ".claude/skills",
          (text) => ({
            binary: "claude",
            args: ["-p", text, "--max-turns", String(maxTurns), "--allowedTools", ...claudeTools],
          }),
          prompt,
          cwd,
          timeoutMs,
        ),
    },
    {
      tool: "codex",
      available: () => onPath("codex", env()) && (env().OPENAI_API_KEY ?? "") !== "",
      run: (prompt, cwd, timeoutMs) =>
        runWithShim(
          options,
          "codex",
          ".agents/skills",
          (text) => ({
            binary: "codex",
            args: ["exec", "--sandbox", "workspace-write", "--skip-git-repo-check", text],
          }),
          prompt,
          cwd,
          timeoutMs,
        ),
    },
  ];
}
