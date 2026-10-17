import { CommanderError } from "commander";
import { errorJson, errorText, exitCodes, RelayError } from "../core/error.js";

export function reportFailure(error: unknown, json: boolean): number {
  if (error instanceof CommanderError) {
    if (error.exitCode === 0) return exitCodes.ok;
    if (error.code === "commander.help") {
      // Commander already printed help text unless --json dropped it.
      if (json) process.stderr.write(errorJson(new RelayError("usage", "error: missing command")));
      return exitCodes.usage;
    }
    const wrapped = new RelayError("usage", error.message);
    process.stderr.write(json ? errorJson(wrapped) : errorText(wrapped));
    return exitCodes.usage;
  }
  if (error instanceof RelayError) {
    process.stderr.write(json ? errorJson(error) : errorText(error));
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : "unknown error";
  const wrapped = new RelayError("usage", message);
  process.stderr.write(json ? errorJson(wrapped) : errorText(wrapped));
  return exitCodes.usage;
}
