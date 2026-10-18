import { RelayError } from "./error.js";
import { schemaVersion } from "./vocab.js";

const part = "(0|[1-9][0-9]*)";
const rangePattern = new RegExp(`^>=${part}\\.${part}\\.${part}$`);
const versionPattern = new RegExp(`^${part}\\.${part}\\.${part}$`);

export const installCommand = "npm i -g @tranthethang/agent-relay@latest";

export type PreflightResult = {
  schema: typeof schemaVersion;
  ok: boolean;
  installed: string;
  required: string;
};

function parts(value: string, pattern: RegExp): [number, number, number] | undefined {
  const match = pattern.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function versionMeets(installed: string, range: string): boolean {
  const required = parts(range, rangePattern);
  const have = parts(installed, versionPattern);
  if (required === undefined) {
    throw new RelayError("usage", "requires must be >=X.Y.Z", "requires");
  }
  if (have === undefined) {
    throw new RelayError("usage", "installed version must be X.Y.Z", "version");
  }
  for (let index = 0; index < 3; index += 1) {
    const left = have[index] ?? 0;
    const right = required[index] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export function preflightResult(installed: string, range: string): PreflightResult {
  return {
    schema: schemaVersion,
    ok: versionMeets(installed, range),
    installed,
    required: range,
  };
}
