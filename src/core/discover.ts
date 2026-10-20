import { readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { RelayError } from "./error.js";
import { isEnoent, joinUnder } from "./files.js";
import { runDirNamePattern, runIdSchema, slugSchema } from "./vocab.js";

export function runIdFromName(name: string): string {
  return name.split("-")[1] ?? "";
}

export function runSlugFromName(name: string): string {
  return name.replace(/^\d{8}-\d{10,11}-/, "");
}

export async function findRelayDir(cwd: string): Promise<string> {
  let current = resolve(cwd);
  for (;;) {
    if (basename(current) === ".agent-relay" && await isDirectory(current)) return current;
    const nested = joinUnder(current, ".agent-relay");
    if (await isDirectory(nested)) return nested;
    const parent = dirname(current);
    if (parent === current || await exists(joinUnder(current, ".git"))) {
      throw new RelayError("not_found", ".agent-relay not found", cwd);
    }
    current = parent;
  }
}

export async function listRunNames(relayDir: string): Promise<string[]> {
  const entries = await readdir(relayDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && runDirNamePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

export async function resolveRun(relayDir: string, token: string, cwd: string): Promise<string> {
  const direct = await existingRunPath(token, cwd);
  if (typeof direct === "string") return direct;

  if (runDirNamePattern.test(token)) {
    const candidate = joinUnder(relayDir, token);
    if (await isDirectory(candidate)) return candidate;
    throw new RelayError("not_found", "run not found", token);
  }

  const runs = await listRunNames(relayDir);
  if (runIdSchema.safeParse(token).success) {
    return oneHit(runs.filter((name) => runIdFromName(name) === token), relayDir, token);
  }
  if (slugSchema.safeParse(token).success) {
    return oneHit(runs.filter((name) => runSlugFromName(name) === token), relayDir, token);
  }
  throw new RelayError("not_found", "run not found", token);
}

function oneHit(hits: string[], relayDir: string, token: string): string {
  const [hit, extra] = hits;
  if (hit === undefined) throw new RelayError("not_found", "run not found", token);
  if (extra !== undefined) throw new RelayError("ambiguous", "run is ambiguous", token);
  return joinUnder(relayDir, hit);
}

async function existingRunPath(token: string, cwd: string): Promise<string | null> {
  const looksLikePath = isAbsolute(token) || token.startsWith(".") || token.includes("/")
    || token.includes("\\");
  const candidate = isAbsolute(token) ? resolve(token) : resolve(cwd, token);
  if (!await isDirectory(candidate)) {
    if (looksLikePath) throw new RelayError("not_found", "run not found", token);
    return null;
  }
  if (!runDirNamePattern.test(basename(candidate))) {
    if (looksLikePath) throw new RelayError("not_found", "run not found", token);
    return null;
  }
  return candidate;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isDirectory();
  } catch (error) {
    if (isEnoent(error)) return false;
    throw error;
  }
}
