import { type Command } from "commander";
import {
  claimTask,
  claimText,
  listTasks,
  listText,
  releaseTask,
  releaseText,
  stealTask,
} from "../core/claim.js";
import { RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { writeResult } from "./output.js";

export function registerClaim(program: Command): void {
  program
    .command("claim")
    .description("Claim a task for one session")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .requiredOption("--session <tag>", "session tag")
    .action(async (run: string, task: string, opts: { session: string }, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await claimTask(runDir, task, opts.session), commandJson(command), claimText);
    });

  program
    .command("release")
    .description("Release a claimed task")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .requiredOption("--session <tag>", "session tag")
    .option("--force", "release a lock this session does not own")
    .option("--reason <text>", "why the forced release happens")
    .action(async (
      run: string,
      task: string,
      opts: { session: string; force?: boolean; reason?: string },
      command: Command,
    ) => {
      const runDir = await takeRun(command, run);
      writeResult(
        await releaseTask(runDir, task, opts.session, opts.force === true, opts.reason),
        commandJson(command),
        releaseText,
      );
    });

  program
    .command("steal")
    .description("Take a stale task lock")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .requiredOption("--session <tag>", "session tag")
    .requiredOption("--ttl <minutes>", "lock age in minutes")
    .action(async (
      run: string,
      task: string,
      opts: { session: string; ttl: string },
      command: Command,
    ) => {
      const runDir = await takeRun(command, run);
      writeResult(
        await stealTask(runDir, task, opts.session, parseTtl(opts.ttl)),
        commandJson(command),
        claimText,
      );
    });

  program
    .command("list")
    .description("List tasks with status, owner, and blocked deps")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await listTasks(runDir), commandJson(command), listText);
    });
}

function parseTtl(value: string): number {
  const ttl = Number(value);
  if (!Number.isFinite(ttl)) {
    throw new RelayError("usage", "ttl must be a non-negative number", "ttl");
  }
  return ttl;
}

async function takeRun(command: Command, positional: string | undefined): Promise<string> {
  const token = oneToken(positional, flagRun(command));
  if (token === undefined) throw new RelayError("usage", "run is required", "run");
  return selectRun(process.cwd(), token);
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}
