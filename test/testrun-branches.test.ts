import { expect, test, vi } from "vitest";
import { killTree, runTestCommand, shellCommand, signalGroup } from "../src/core/testrun.js";

const missingPid = 2_000_000_000;

test("shellCommand uses /bin/sh off Windows", () => {
  expect(shellCommand("echo hi", "linux", {})).toEqual({
    shell: "/bin/sh",
    args: ["-c", "echo hi"],
  });
});

test("shellCommand uses ComSpec on Windows", () => {
  expect(shellCommand("echo hi", "win32", { ComSpec: String.raw`C:\cmd.exe` })).toEqual({
    shell: String.raw`C:\cmd.exe`,
    args: ["/d", "/s", "/c", `"echo hi"`],
  });
});

test("shellCommand falls back to cmd.exe when ComSpec is unset", () => {
  expect(shellCommand("echo hi", "win32", {}).shell).toBe("cmd.exe");
});

test("runTestCommand on the Windows path reports a missing shell as exit 127", async () => {
  const result = await runTestCommand(process.cwd(), `node -e "process.exit(3)"`, 5000, "win32");
  // Off Windows there is no cmd.exe, so spawn fails and the close after the error is ignored.
  expect(result.tests).toMatchObject({ exit: process.platform === "win32" ? 3 : 127 });
});

test("runTestCommand maps a shell killed by a signal to exit 1", async () => {
  const result = await runTestCommand(
    process.cwd(),
    `node -e "process.kill(process.ppid, 'SIGKILL')" && node -e "0"`,
  );
  expect(result.tests).toMatchObject({ exit: 1 });
});

test("runTestCommand keeps a partial last line and splits CR line ends", async () => {
  const result = await runTestCommand(
    process.cwd(),
    `node -e "process.stdout.write('a\\r\\nb\\rc')"`,
  );
  expect(result.stdout).toBe("a\nb\nc");
});

test("signalGroup does nothing without a pid", () => {
  const kill = vi.fn();
  signalGroup({ pid: undefined, kill }, "SIGTERM");
  expect(kill).not.toHaveBeenCalled();
});

test("signalGroup signals the child when its group is gone", () => {
  const kill = vi.fn();
  signalGroup({ pid: missingPid, kill }, "SIGTERM");
  expect(kill).toHaveBeenCalledWith("SIGTERM");
});

test("killTree does nothing without a pid", () => {
  const kill = vi.fn();
  killTree({ pid: undefined, kill }, "win32");
  killTree({ pid: undefined, kill }, "linux");
  expect(kill).not.toHaveBeenCalled();
});

test("killTree on the Windows path kills the child when taskkill cannot start", async () => {
  if (process.platform === "win32") return;
  const killed = new Promise<void>((resolve) => {
    killTree({ pid: missingPid, kill: () => (resolve(), true) }, "win32");
  });
  await expect(killed).resolves.toBeUndefined();
});

test("runTestCommand keeps only the last 200 lines", async () => {
  const result = await runTestCommand(
    process.cwd(),
    `node -e "for (let i = 0; i < 205; i++) console.log(i)"`,
  );
  const lines = result.stdout.split("\n");
  expect(lines).toHaveLength(200);
  expect(lines[0]).toBe("5");
});
