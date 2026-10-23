import { type Command } from "commander";
import { oneToken, selectRun } from "../core/select.js";
import {
  parseStatsSince,
  type StatsFilter,
  statsForRelay,
  statsForRun,
  statsText,
} from "../core/stats.js";
import { commandJson, flagRun } from "./distill.js";
import { writeResult } from "./output.js";

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Report stage time, review rounds, waivers, failed tests, and drift")
    .argument("[run]", "run id, slug, name, or path")
    .option("--since <date>", "keep runs with an event at or after this ISO date")
    .option("--failed", "keep runs with at least one failed test")
    .action(
      async (
        run: string | undefined,
        opts: { since?: string; failed?: boolean },
        command: Command,
      ) => {
        const filter: StatsFilter = {
          ...(opts.since === undefined ? {} : { since: parseStatsSince(opts.since) }),
          failed: opts.failed === true,
        };
        const token = oneToken(run, flagRun(command));
        const result = token === undefined
          ? await statsForRelay(process.cwd(), filter)
          : await statsForRun(await selectRun(process.cwd(), token), filter);
        writeResult(result, commandJson(command), statsText);
      },
    );
}
