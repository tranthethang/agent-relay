import { type CliResult, runCli } from "./helper.js";

export async function mustCli(args: string[], cwd: string): Promise<CliResult> {
  const result = await runCli(args, cwd);
  if (result.code !== 0) {
    throw new Error(`${args.join(" ")}\n${result.stderr}${result.stdout}`);
  }
  return result;
}
