import { devMarker } from "../version.js";
import { RelayError } from "./error.js";
import { schemaVersion } from "./vocab.js";

const part = String.raw`(0|[1-9]\d*)`;
const rangePattern = new RegExp(String.raw`^>=${part}\.${part}\.${part}$`);
const versionPattern = new RegExp(String.raw`^${part}\.${part}\.${part}$`);

export const installCommand = "npm i -g @tranthethang/agent-relay@latest";

export type PreflightResult = {
  schema: typeof schemaVersion;
  ok: boolean;
  installed: string;
  required: string;
  dev?: true;
};

// A dev build reports `<base>-dev`. The base is the release version it was
// built from, so consent compares that base and the result still marks the dev
// build. A release version passes through unchanged.
function baseVersion(version: string): string {
  const at = version.indexOf(devMarker);
  return at === -1 ? version : version.slice(0, at);
}

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
  const [haveMajor, haveMinor, havePatch] = have;
  const [needMajor, needMinor, needPatch] = required;
  const pairs: [number, number][] = [
    [haveMajor, needMajor],
    [haveMinor, needMinor],
    [havePatch, needPatch],
  ];
  for (const [left, right] of pairs) {
    if (left !== right) return left > right;
  }
  return true;
}

export function preflightResult(
  installed: string,
  range: string,
  allowDev = false,
): PreflightResult {
  const base = baseVersion(installed);
  const dev = base !== installed;
  const result: PreflightResult = {
    schema: schemaVersion,
    ok: false,
    installed,
    required: range,
  };
  if (dev) result.dev = true;
  const meets = versionMeets(base, range);
  result.ok = dev && !allowDev ? false : meets;
  return result;
}
