import { type Command } from "commander";
import { distillRun, distillText, distillVerifyText, verifyDistill } from "../core/distill.js";
import { RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { writeResult } from "./output.js";

export function registerDistill(program: Command): void {
  const distill = program
    .command("distill")
    .description("Write or verify a sha256 manifest of the run files");
  distill
    .command("verify")
    .description("Recompute each hash and report a missing or different file")
    .argument("<run>", "run id, slug, name, or path")
    .action(async (run: string, _opts: unknown, command: Command) => {
      const result = await verifyDistill(await takeRun(command, run));
      writeResult(result, commandJson(command), distillVerifyText);
      if (!result.ok) process.exitCode = 1;
    });
  distill
    .argument("<run>", "run id, slug, name, or path")
    .option("--include-test-logs", "include *.test.log files in the manifest")
    .action(async (run: string, opts: { includeTestLogs?: boolean }, command: Command) => {
      const runDir = await takeRun(command, run);
      writeResult(
        await distillRun(runDir, { includeTestLogs: opts.includeTestLogs === true }),
        commandJson(command),
        distillText,
      );
    });
}

export async function takeRun(command: Command, positional: string | undefined): Promise<string> {
  const token = oneToken(positional, flagRun(command));
  if (token === undefined) throw new RelayError("usage", "run is required", "run");
  return selectRun(process.cwd(), token);
}

export function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

export function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}
