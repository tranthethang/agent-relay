import { type Command } from "commander";
import { RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { cleanupWorktree, worktreeCleanupText } from "../core/worktree.js";
import { writeResult } from "./output.js";

export function registerWorktree(program: Command): void {
  const worktree = program.command("worktree").description("Worktree operations");
  worktree
    .command("cleanup")
    .description("Remove worktree for a closed run")
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
