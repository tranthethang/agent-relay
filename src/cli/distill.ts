import { type Command } from "commander";
import { distillRun, distillText } from "../core/distill.js";
import { RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { writeResult } from "./output.js";

export function registerDistill(program: Command): void {
  program
    .command("distill")
    .description("Write a sha256 manifest of the run files")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(await distillRun(runDir), commandJson(command), distillText);
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
