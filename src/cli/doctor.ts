import { type Command } from "commander";
import { doctorReport, doctorText } from "../core/doctor.js";
import { commandJson } from "./distill.js";
import { writeResult } from "./output.js";

export function registerDoctor(program: Command): void {
  program
    .command("doctor")
    .description("Check Node, git, the CLI version, skills, policy, and PATH")
    .action(async (_opts: unknown, command: Command) => {
      const result = await doctorReport({ cwd: process.cwd(), env: process.env });
      writeResult(result, commandJson(command), doctorText);
      if (!result.ok) process.exitCode = 1;
    });
}
