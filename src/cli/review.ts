import { type Command } from "commander";
import { decideQuestion, decideText } from "../core/decide.js";
import { reviewDone, reviewDoneText, reviewNew, reviewNewText } from "../core/review.js";
import { commandJson, takeRun } from "./distill.js";
import { withWarnings, writeResult } from "./output.js";

export function registerReview(program: Command): void {
  const review = program.command("review").description("Scaffold and finish a review");
  review
    .command("decide")
    .description("Record a decision for an open review question")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<question>", "question id such as Q1")
    .argument("<answer>", "choice or text answer")
    .action(
      async (run: string, question: string, answer: string, _opts: unknown, command: Command) => {
        const runDir = await takeRun(command, run);
        writeResult(
          await decideQuestion({ runDir, questionId: question, answer }),
          commandJson(command),
          decideText,
        );
      },
    );
  review
    .command("new")
    .description("Scaffold the next numbered review pair")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<kind>", "self or cross")
    .requiredOption("--tool <tool>", "tool name")
    .option("--model <model>", "model id")
    .action(async (
      run: string,
      kind: string,
      opts: { tool: string; model?: string },
      command: Command,
    ) => {
      const runDir = await takeRun(command, run);
      writeResult(
        await reviewNew({ runDir, kind, tool: opts.tool, model: opts.model }),
        commandJson(command),
        reviewNewText,
      );
    });
  review
    .command("done")
    .description("Validate the latest review and record completion")
    .argument("<run>", "run id, slug, name, or path")
    .argument("<kind>", "self or cross")
    .action(async (run: string, kind: string, _opts: unknown, command: Command) => {
      const runDir = await takeRun(command, run);
      const result = await reviewDone({ runDir, kind });
      for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
      const { warnings, ...body } = result;
      writeResult(withWarnings(body, warnings), commandJson(command), reviewDoneText);
    });
}
