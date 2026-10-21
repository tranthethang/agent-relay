import { type Command } from "commander";
import { hookCheck, hookInstallText, installHook } from "../core/hook.js";
import { writeResult } from "./output.js";

export function registerHook(program: Command): void {
  const hook = program
    .command("hook")
    .description("Install or run the Claude Code edit hook");

  hook
    .command("install")
    .description("Add the edit hook to .claude/settings.json at the git root")
    .requiredOption("--tool <tool>", "tool name; only claude-code is supported")
    .action(async (opts: { tool: string }, command: Command) => {
      writeResult(
        await installHook(process.cwd(), opts.tool),
        command.optsWithGlobals().json === true,
        hookInstallText,
      );
    });

  hook
    .command("check")
    .description("Check one edit from Claude Code hook JSON on stdin")
    .action(async () => {
      await runHookCheck(process.stdin);
    });
}

// A hook error must not block editing, so every failure allows the edit.
export async function runHookCheck(input: AsyncIterable<unknown>): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    }
    const decision = await hookCheck(Buffer.concat(chunks).toString("utf8"));
    if (decision !== null) process.stdout.write(`${JSON.stringify(decision)}\n`);
  } catch {
    // Allowed.
  }
}
