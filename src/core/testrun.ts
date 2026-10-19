import { type ChildProcess, spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export type TestExecution = {
  tests: { exit: number; ms: number } | "not-configured";
  stdout: string;
  stderr: string;
};

const defaultTimeoutMs = 10 * 60 * 1000;
const tailLimit = 200;

export function runTestCommand(
  cwd: string,
  command: string | undefined,
  timeoutMs = defaultTimeoutMs,
): Promise<TestExecution> {
  if (command === undefined) {
    return Promise.resolve({ tests: "not-configured", stdout: "", stderr: "" });
  }
  const started = performance.now();
  const shell = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
  // Windows: the same cmd.exe arguments that Node uses for `shell: true`.
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `"${command}"`] : ["-c", command];
  return new Promise((resolve) => {
    // Unix: own process group, so a timeout can kill the shell and its children.
    const child = spawn(shell, args, {
      cwd,
      detached: process.platform !== "win32",
      windowsHide: true,
      windowsVerbatimArguments: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = new LineTail(tailLimit);
    const stderr = new LineTail(tailLimit);
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    child.on("exit", () => {
      // A child that outlives the shell can hold the pipes open after a timeout.
      if (!timedOut) return;
      child.stdout.destroy();
      child.stderr.destroy();
    });
    // A detached group does not get the terminal's Ctrl+C, so pass the signal on.
    const forward = (signal: NodeJS.Signals): void => {
      stopForwarding();
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
      process.kill(process.pid, signal);
    };
    const stopForwarding = (): void => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
    };
    if (process.platform !== "win32") {
      process.once("SIGINT", forward);
      process.once("SIGTERM", forward);
    }
    const finish = (exit: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopForwarding();
      resolve({
        tests: { exit, ms: Math.max(0, Math.round(performance.now() - started)) },
        stdout: stdout.text(),
        stderr: stderr.text(),
      });
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => stdout.push(chunk));
    child.stderr.on("data", (chunk: string) => stderr.push(chunk));
    child.on("error", () => finish(127));
    child.on("close", (code) => finish(timedOut ? 124 : code ?? 1));
  });
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    const taskkill = String.raw`C:\Windows\System32\taskkill.exe`;
    spawn(taskkill, ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    }).on("error", () => child.kill());
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

class LineTail {
  private pending = "";
  private readonly lines: string[] = [];

  constructor(private readonly limit: number) {}

  push(chunk: string): void {
    const parts = `${this.pending}${chunk}`.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split(
      "\n",
    );
    this.pending = parts.pop() ?? "";
    for (const line of parts) {
      this.lines.push(line);
      if (this.lines.length > this.limit) this.lines.shift();
    }
  }

  text(): string {
    const lines = this.pending.length > 0 ? [...this.lines, this.pending] : this.lines;
    return lines.slice(-this.limit).join("\n");
  }
}
