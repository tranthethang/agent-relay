import { join } from "node:path";
import { findRelayDir, listRunNames, resolveRun } from "./discover.js";
import { RelayError } from "./error.js";

export async function selectRun(cwd: string, token: string | undefined): Promise<string> {
  const relayDir = await findRelayDir(cwd);
  if (token !== undefined) return resolveRun(relayDir, token, cwd);
  const names = await listRunNames(relayDir);
  if (names.length === 1) return join(relayDir, names[0] ?? "");
  if (names.length === 0) throw new RelayError("not_found", "run not found", "");
  throw new RelayError("ambiguous", "run is ambiguous", "");
}

export function oneToken(
  positional: string | undefined,
  flag: string | undefined,
): string | undefined {
  if (positional !== undefined && flag !== undefined && positional !== flag) {
    throw new RelayError("usage", "--run and the run argument differ", "run");
  }
  return positional ?? flag;
}
