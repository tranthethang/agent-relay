import { type Command } from "commander";
import { oneToken, selectRun } from "../core/select.js";
import { statsForRelay, statsForRun, statsText } from "../core/stats.js";
import { commandJson, flagRun } from "./distill.js";
import { writeResult } from "./output.js";

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Report stage time, review rounds, waivers, failed tests, and drift")
    .argument("[run]", "run id, slug, name, or path")
    .action(async (run: string | undefined, _opts: unknown, command: Command) => {
      const token = oneToken(run, flagRun(command));
      const result = token === undefined
        ? await statsForRelay(process.cwd())
        : await statsForRun(await selectRun(process.cwd(), token));
      writeResult(result, commandJson(command), statsText);
    });
}
