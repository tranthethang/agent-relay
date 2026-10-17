import { type Command } from "commander";
import { basename } from "node:path";
import { contextFor, contextText } from "../core/context.js";
import { findRelayDir, runIdFromName, runSlugFromName } from "../core/discover.js";
import { RelayError } from "../core/error.js";
import { oneToken, selectRun } from "../core/select.js";
import { statusDetail, statusDetailText, statusList, statusListText } from "../core/status.js";
import { schemaVersion } from "../core/vocab.js";
import { registerLifecycle } from "./lifecycle.js";
import { writeResult } from "./output.js";
import { registerPlan } from "./plan.js";

export function registerCommands(program: Command): void {
  program
    .command("resolve")
    .description("Print the run directory")
    .argument("[run]", "run id, slug, name, or path")
    .action(async (run: string | undefined, _opts: unknown, command: Command) => {
      const runDir = await selectRun(process.cwd(), oneToken(run, flagRun(command)));
      const name = basename(runDir);
      writeResult(
        {
          schema: schemaVersion,
          path: runDir,
          name,
          id: runIdFromName(name),
          ymd: name.slice(0, 8),
          slug: runSlugFromName(name),
        },
        commandJson(command),
        (row) => `${row.path}\n`,
      );
    });

  program
    .command("status")
    .description("Show run status")
    .argument("[run]", "run id, slug, name, or path")
    .action(async (run: string | undefined, _opts: unknown, command: Command) => {
      const token = oneToken(run, flagRun(command));
      const json = commandJson(command);
      if (token === undefined) {
        const result = await statusList(await findRelayDir(process.cwd()), Date.now());
        writeResult(result, json, statusListText);
        return;
      }
      writeResult(
        await statusDetail(await selectRun(process.cwd(), token), Date.now()),
        json,
        statusDetailText,
      );
    });

  program
    .command("context")
    .description("Print the run context")
    .argument("[run]", "run id, slug, name, or path")
    .option("--task <id>", "add one task's plan and implement paths")
    .action(async (run: string | undefined, opts: { task?: string }, command: Command) => {
      const token = oneToken(run, flagRun(command));
      if (token === undefined) throw new RelayError("usage", "run is required", "run");
      const result = await contextFor(await selectRun(process.cwd(), token), opts.task);
      writeResult(result, commandJson(command), contextText);
    });

  registerLifecycle(program);
  registerPlan(program);
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}
