import { type Command } from "commander";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { RelayError } from "../core/error.js";
import { isEnoent } from "../core/files.js";
import {
  approvePreview,
  approvePreviewText,
  approveRun,
  approveText,
  brainstormDoneText,
  closePreview,
  closePreviewText,
  closeRun,
  closeText,
  doneStage,
  finishBrainstorm,
  stageText,
  startStage,
} from "../core/lifecycle.js";
import { brainstormNewText, createBrainstorm, createRun, runNewText } from "../core/scaffold.js";
import { oneToken, selectRun } from "../core/select.js";
import { writeResult } from "./output.js";

export function registerLifecycle(program: Command): void {
  const run = program.command("run").description("Create a run");
  run
    .command("new")
    .description("Create a run directory")
    .requiredOption("--slug <slug>", "run slug")
    .requiredOption("--title <title>", "run title")
    .option("--from <brainstorm>", "brainstorm directory")
    .action(async (opts: { slug: string; title: string; from?: string }, command: Command) => {
      const result = await createRun({
        cwd: process.cwd(),
        slug: opts.slug,
        title: opts.title,
        from: opts.from,
      });
      writeResult(result, commandJson(command), runNewText);
    });

  const brainstorm = program.command("brainstorm").description("Create a brainstorm");
  brainstorm
    .command("new")
    .description("Scaffold a brainstorm directory")
    .requiredOption("--slug <slug>", "brainstorm slug")
    .action(async (opts: { slug: string }, command: Command) => {
      const result = await createBrainstorm({ cwd: process.cwd(), slug: opts.slug });
      writeResult(result, commandJson(command), brainstormNewText);
    });
  brainstorm
    .command("done")
    .description("Validate brainstorm open.json")
    .argument("<dir>", "brainstorm directory")
    .action(async (dir: string, _opts: unknown, command: Command) => {
      const path = await brainstormDir(dir);
      writeResult(await finishBrainstorm(path), commandJson(command), brainstormDoneText);
    });

  const stage = program.command("stage").description("Start or finish a stage");
  stage
    .command("start")
    .description("Record a stage start")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<stage>", "plan, implement, self-review, or cross-review")
    .requiredOption("--tool <tool>", "tool name")
    .option("--model <model>", "model id")
    .action(stageAction("started"));
  stage
    .command("done")
    .description("Record a stage finish")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<stage>", "plan, implement, self-review, or cross-review")
    .requiredOption("--tool <tool>", "tool name")
    .option("--model <model>", "model id")
    .option("--allow-extra <reason>", "accept edits outside the task files")
    .action(stageAction("completed"));

  program
    .command("approve")
    .description("Record plan approval")
    .argument("[run]", "run id, slug, name, or path")
    .option("--via <via>", "confirm or arg")
    .option("--preview", "print Goal, Decisions, and the task count")
    .action(async (
      run: string | undefined,
      opts: { via?: string; preview?: boolean },
      command: Command,
    ) => {
      const runDir = await takeRun(command, run);
      if (opts.preview === true) {
        writeResult(await approvePreview(runDir), commandJson(command), approvePreviewText);
        return;
      }
      if (opts.via === undefined) throw new RelayError("usage", "via is required", "via");
      writeResult(await approveRun({ runDir, via: opts.via }), commandJson(command), approveText);
    });

  program
    .command("close")
    .description("Close or abandon a run")
    .argument("[run]", "run id, slug, name, or path")
    .option("--ack-open", "close while the latest review has open questions")
    .option("--ack-fixes", "accept fixes made after the latest review started")
    .option("--waive-review <reason>", "close without required reviews")
    .option("--via <via>", "confirm or arg")
    .option("--abandon <reason>", "abandon the run")
    .option("--preview", "print the close recommendation")
    .action(async (
      run: string | undefined,
      opts: {
        ackOpen?: boolean;
        ackFixes?: boolean;
        via?: string;
        abandon?: string;
        waiveReview?: string;
        preview?: boolean;
      },
      command: Command,
    ) => {
      const runDir = await takeRun(command, run);
      if (opts.preview === true) {
        writeResult(await closePreview(runDir), commandJson(command), closePreviewText);
        return;
      }
      writeResult(
        await closeRun({
          runDir,
          via: opts.via,
          ackOpen: opts.ackOpen === true,
          ackFixes: opts.ackFixes === true,
          abandon: opts.abandon,
          waiveReview: opts.waiveReview,
        }),
        commandJson(command),
        closeText,
      );
    });
}

function stageAction(action: "started" | "completed") {
  return async (
    run: string,
    stageName: string,
    opts: { tool: string; model?: string; allowExtra?: string },
    command: Command,
  ) => {
    const runDir = await takeRun(command, run);
    const input = {
      runDir,
      stage: stageName,
      tool: opts.tool,
      model: opts.model,
    };
    const result = action === "started"
      ? await startStage(input)
      : await doneStage({ ...input, allowExtra: opts.allowExtra });
    writeResult(result, commandJson(command), stageText);
  };
}

async function takeRun(command: Command, positional: string | undefined): Promise<string> {
  const token = oneToken(positional, flagRun(command));
  if (token === undefined) throw new RelayError("usage", "run is required", "run");
  return selectRun(process.cwd(), token);
}

async function brainstormDir(token: string): Promise<string> {
  const path = resolve(process.cwd(), token);
  try {
    const info = await stat(path);
    if (!info.isDirectory()) throw new RelayError("not_found", "brainstorm not found", token);
  } catch (error) {
    if (error instanceof RelayError) throw error;
    if (isEnoent(error)) throw new RelayError("not_found", "brainstorm not found", token);
    throw error;
  }
  return path;
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}
