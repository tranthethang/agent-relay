import { type Command } from "commander";
import { basename } from "node:path";
import { rebuildRun } from "../core/cache.js";
import { contextFor, contextText } from "../core/context.js";
import { findRelayDir, runIdFromName, runSlugFromName } from "../core/discover.js";
import { exitCodes, RelayError } from "../core/error.js";
import { type EventLine } from "../core/event.js";
import { reviewIntegrity } from "../core/lifecycle.js";
import { explainNext, nextStep } from "../core/next.js";
import { installCommand, preflightResult } from "../core/preflight.js";
import { type RunState } from "../core/reduce.js";
import { oneToken, selectRun } from "../core/select.js";
import { statusDetail, statusDetailText, statusList, statusListText } from "../core/status.js";
import { indexForImplement } from "../core/tasks.js";
import { schemaVersion } from "../core/vocab.js";
import { packageVersion } from "../version.js";
import { registerClaim } from "./claim.js";
import { registerDistill } from "./distill.js";
import { registerLifecycle } from "./lifecycle.js";
import { writeResult } from "./output.js";
import { registerPlan } from "./plan.js";
import { registerPolicy } from "./policy.js";
import { registerReview } from "./review.js";

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
    .command("next")
    .description("Print the next command for a run")
    .argument("[run]", "run id, slug, name, or path")
    .action(async (run: string | undefined, _opts: unknown, command: Command) => {
      const token = oneToken(run, flagRun(command));
      if (token === undefined) throw new RelayError("usage", "run is required", "run");
      const runDir = await selectRun(process.cwd(), token);
      const loaded = await rebuildRun(runDir);
      const reviews = await reviewsForNext(
        runDir,
        loaded.run.base,
        loaded.events,
        loaded.run.state.lifecycle,
      );
      const index = loaded.run.state.lifecycle === "implementing"
        ? await indexForImplement(runDir, loaded.run.state)
        : null;
      const step = nextStep(loaded.run.id, loaded.run.state, loaded.events, reviews, index);
      writeResult(explainNext(step), commandJson(command), (row) => `${row.command}\n`);
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

  program
    .command("preflight")
    .description("Check the installed version against a >=X.Y.Z range")
    .requiredOption("--requires <range>", "minimum version, >=X.Y.Z")
    .action((opts: { requires: string }, command: Command) => {
      const result = preflightResult(packageVersion(), opts.requires);
      writeResult(result, commandJson(command), (row) => (row.ok ? "" : `${installCommand}\n`));
      if (!result.ok) process.exitCode = exitCodes.usage;
    });

  registerLifecycle(program);
  registerPlan(program);
  registerClaim(program);
  registerReview(program);
  registerDistill(program);
  registerPolicy(program);
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

function flagRun(command: Command): string | undefined {
  const run = command.optsWithGlobals().run;
  return typeof run === "string" ? run : undefined;
}

async function reviewsForNext(
  runDir: string,
  base: string,
  events: readonly EventLine[],
  lifecycle: RunState["lifecycle"],
) {
  if (lifecycle !== "reviewing") return undefined;
  try {
    return await reviewIntegrity(runDir, base, events);
  } catch (error) {
    if (
      error instanceof RelayError
      && (error.message === "could not read policy from base"
        || error.message === "git index not found")
    ) {
      return undefined;
    }
    throw error;
  }
}
