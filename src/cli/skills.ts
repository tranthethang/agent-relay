import { type Command } from "commander";
import {
  installSkills,
  parseSkillTool,
  skillsInstallText,
  skillsStatusText,
  skillToolDirs,
  statusSkills,
} from "../core/skills.js";
import { commandJson } from "./distill.js";
import { writeResult } from "./output.js";

export function registerSkills(program: Command): void {
  const skills = program.command("skills").description("Install and check the bundled skills");
  skills
    .command("install")
    .description("Copy the bundled skills into a tool directory")
    .requiredOption("--tool <name>", `tool name: ${Object.keys(skillToolDirs).join(", ")}`)
    .option("--dir <path>", "install into this directory")
    .action((opts: { tool: string; dir?: string }, command: Command) => {
      const result = installSkills({
        tool: parseSkillTool(opts.tool),
        ...(opts.dir === undefined ? {} : { dir: opts.dir }),
      });
      writeResult(result, commandJson(command), skillsInstallText);
    });
  skills
    .command("status")
    .description("Compare the installed skills with the running CLI")
    .option("--tool <name>", `tool name: ${Object.keys(skillToolDirs).join(", ")}`)
    .option("--dir <path>", "check this directory")
    .option("--all", "check every known tool directory")
    .action((opts: { tool?: string; dir?: string; all?: boolean }, command: Command) => {
      const tool = opts.tool === undefined ? undefined : parseSkillTool(opts.tool);
      const result = statusSkills({
        ...(tool === undefined ? {} : { tool }),
        ...(opts.dir === undefined ? {} : { dir: opts.dir }),
        all: opts.all === true,
      });
      writeResult(result, commandJson(command), skillsStatusText);
      if (!result.ok) process.exitCode = 1;
    });
}
