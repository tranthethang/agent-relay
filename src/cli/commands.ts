import { type Command } from "commander";
import { basename } from "node:path";
import { rebuildRun } from "../core/cache.js";
import { contextFor, contextText } from "../core/context.js";
import { findRelayDir, runIdFromName, runSlugFromName } from "../core/discover.js";
import { exitCodes, RelayError } from "../core/error.js";
import { type EventLine } from "../core/event.js";
import { reviewIntegrity } from "../core/lifecycle.js";
import { explainNextWithChoices, nextActions, nextStep, nextText } from "../core/next.js";
import { installCommand, preflightResult } from "../core/preflight.js";
import { type RunState } from "../core/reduce.js";
import { oneToken, selectRun } from "../core/select.js";
import { statusDetail, statusDetailText, statusList, statusListText } from "../core/status.js";
import { indexForImplement } from "../core/tasks.js";
import { schemaVersion } from "../core/vocab.js";
import { openTaskWorktrees } from "../core/worktree.js";
import { packageVersion } from "../version.js";
import { registerClaim } from "./claim.js";
import { flagRun, registerDistill } from "./distill.js";
import { registerDoctor } from "./doctor.js";
import { registerHook } from "./hook.js";
import { registerLifecycle } from "./lifecycle.js";
import { writeResult } from "./output.js";
import { registerPlan } from "./plan.js";
import { registerPolicy } from "./policy.js";
import { registerReview } from "./review.js";
import { registerSkills } from "./skills.js";
import { registerStats } from "./stats.js";
import { registerWorktree } from "./worktree.js";

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
    .description("Show run state, available actions, and a recommendation")
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
      const integrate = index === null
        ? []
        : await openTaskWorktrees(runDir, loaded.run, index.tasks.map((task) => task.id));
      const step = nextStep(
        loaded.run.id,
        loaded.run.state,
        loaded.events,
        reviews,
        index,
        integrate,
      );
      const choices = nextActions(
        loaded.run.id,
        loaded.run.state,
        loaded.events,
        step,
        reviews,
        index,
        integrate,
      );
      writeResult(
        explainNextWithChoices(step, loaded.run.state, choices),
        commandJson(command),
        nextText,
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

  program
    .command("preflight")
    .description("Check the installed version against a >=X.Y.Z range")
    .requiredOption("--requires <range>", "minimum version, >=X.Y.Z")
    .option("--allow-dev", "accept a dev build version")
    .action((opts: { requires: string; allowDev?: boolean }, command: Command) => {
      const allowDev = opts.allowDev === true || process.env.ATRY_DEV === "1";
      const result = preflightResult(packageVersion(), opts.requires, allowDev);
      writeResult(result, commandJson(command), (row) => (row.ok ? "" : `${installCommand}\n`));
      if (!result.ok) process.exitCode = exitCodes.usage;
    });

  registerLifecycle(program);
  registerPlan(program);
  registerClaim(program);
  registerReview(program);
  registerDistill(program);
  registerPolicy(program);
  registerSkills(program);
  registerWorktree(program);
  registerHook(program);
  registerStats(program);
  registerDoctor(program);
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}

export async function reviewsForNext(
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
