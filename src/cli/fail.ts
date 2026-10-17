import { CommanderError } from "commander";
import { errorJson, errorText, exitCodes, RelayError } from "../core/error.js";

export function reportFailure(error: unknown, json: boolean): number {
  if (error instanceof CommanderError) return error.exitCode;
  if (error instanceof RelayError) {
    process.stderr.write(json ? errorJson(error) : errorText(error));
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : "unknown error";
  const wrapped = new RelayError("usage", message);
  process.stderr.write(json ? errorJson(wrapped) : errorText(wrapped));
  return exitCodes.usage;
}
