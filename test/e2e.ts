import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CliResult, runCli } from "./helper.js";

export async function mustCli(args: string[], cwd: string): Promise<CliResult> {
  const result = await runCli(args, cwd);
  if (result.code !== 0) {
    throw new Error(`${args.join(" ")}\n${result.stderr}${result.stdout}`);
  }
  return result;
}

export async function completeReview(
  dir: string,
  run: string,
  kind: "self" | "cross",
  tool: string,
  model: string,
): Promise<void> {
  await mustCli(["review", "new", run, kind, "--tool", tool, "--model", model], dir);
  const folder = kind === "self" ? "30-self-review" : "40-cross-review";
  const body = { schema: 1, kind, tool, model, fixed: 0, open: [] };
  await writeFile(join(run, folder, "01.json"), `${JSON.stringify(body)}\n`);
  await mustCli(["review", "done", run, kind], dir);
}

export async function closeRun(dir: string, run: string): Promise<CliResult> {
  return mustCli(["close", run, "--via", "arg", "--json"], dir);
}
