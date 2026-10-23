import { type Command } from "commander";
import { integrateTask, integrateText } from "../core/claim.js";
import { exitCodes, RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { cleanupWorktree, worktreeCleanupText } from "../core/worktree.js";
import { writeResult } from "./output.js";

export function registerWorktree(program: Command): void {
  program
    .command("integrate")
    .description("Merge a task branch into the run branch and remove a clean worktree")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .action(async (run: string, task: string, _opts: unknown, command: Command) => {
      const runDir = await selectRun(process.cwd(), run);
      const result = await integrateTask(runDir, task);
      writeResult(result, commandJson(command), integrateText);
      if (!result.merged) process.exitCode = exitCodes.gate;
    });

  const worktree = program.command("worktree").description("Worktree operations");
  worktree
    .command("cleanup")
    .description("Remove the run worktree for a closed run")
    .argument("[run]", "run id, slug, name, or path")
    .action(async (run: string | undefined, _opts: unknown, command: Command) => {
      const token = oneToken(run, flagRun(command));
      if (token === undefined) throw new RelayError("usage", "run is required", "run");
      const runDir = await selectRun(process.cwd(), token);
      const result = await cleanupWorktree(runDir);
      writeResult(result, commandJson(command), worktreeCleanupText);
    });
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}
