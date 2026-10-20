import { type Command } from "commander";
import { checkPolicy, initPolicy } from "../core/policy.js";
import { writeResult } from "./output.js";

export function registerPolicy(program: Command): void {
  const policy = program
    .command("policy")
    .description("Create or check .agent-relay.json");

  policy
    .command("init")
    .description("Write a default .agent-relay.json at the git root")
    .action(async (_opts: unknown, command: Command) => {
      writeResult(
        await initPolicy(process.cwd()),
        commandJson(command),
        (row) => `path: ${row.path}\ncommit the file to apply it\n`,
      );
    });

  policy
    .command("check")
    .description("Validate .agent-relay.json in the working tree")
    .action(async (_opts: unknown, command: Command) => {
      writeResult(
        await checkPolicy(process.cwd()),
        commandJson(command),
        (row) => `ok: ${row.path}\n`,
      );
    });
}

function commandJson(command: Command): boolean {
  return command.optsWithGlobals().json === true;
}
