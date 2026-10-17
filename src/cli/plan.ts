import { type Command } from "commander";
import { RelayError } from "../core/error.js";
import {
  planAmend,
  planDone,
  planDoneText,
  planNew,
  planNewText,
  taskDone,
  taskMoveText,
  taskSkip,
  taskStart,
} from "../core/plan.js";
import { oneToken, selectRun } from "../core/select.js";
import { writeResult } from "./output.js";

export function registerPlan(program: Command): void {
  const plan = program.command("plan").description("Scaffold and validate a plan");
  plan
    .command("new")
    .description("Scaffold overview.md and tasks.input.json")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await planNew(runDir), commandJson(command), planNewText);
    });
  plan
    .command("done")
    .description("Validate tasks and write the plan index")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await planDone(runDir), commandJson(command), planDoneText);
    });
  plan
    .command("amend")
    .description("Keep existing task ids and append new ones")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await planAmend(runDir), commandJson(command), planDoneText);
    });

  const task = program.command("task").description("Update one task");
  task
    .command("start")
    .description("Start a task whose deps are done or skipped")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .action(async (run: string, taskId: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await taskStart(runDir, taskId), commandJson(command), taskMoveText);
    });
  task
    .command("done")
    .description("Mark a started task done")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .action(async (run: string, taskId: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await taskDone(runDir, taskId), commandJson(command), taskMoveText);
    });
  task
    .command("skip")
    .description("Skip a task")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<task>", "task id")
    .requiredOption("--reason <text>", "why the task is skipped")
    .action(async (run: string, taskId: string, opts: { reason: string }, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await taskSkip(runDir, taskId, opts.reason), commandJson(command), taskMoveText);
    });
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
