import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { RelayError } from "./error.js";

const waitLimitMs = 10_000;
export const staleLockMs = 30_000;
const pollMs = 50;

export type RunLock = { path: string; token: string };

type Snapshot = { text: string; mtimeMs: number };

// `locks/run.lock` serializes state changes for one run.
export async function acquireRunLock(runDir: string): Promise<RunLock> {
  const lockDir = join(runDir, "locks");
  await mkdir(lockDir, { recursive: true });
  const path = join(lockDir, "run.lock");
  const token = randomBytes(16).toString("hex");
  const deadline = Date.now() + waitLimitMs;
  for (;;) {
    if (await tryCreateLock(path, lockBody(token))) return { path, token };
    await waitForLock(path, deadline);
  }
}

// Removes the lock only while it still holds this owner's token.
export async function releaseRunLock(lock: RunLock): Promise<void> {
  let text: string;
  try {
    text = await readFile(lock.path, "utf8");
  } catch (error) {
    if (lockCode(error) === "ENOENT") return;
    throw error;
  }
  if (ownerToken(text) !== lock.token) return;
  await rm(lock.path, { force: true });
}

function lockBody(token: string): string {
  return JSON.stringify({
    pid: process.pid,
    host: hostname() || "unknown",
    ts: new Date().toISOString(),
    token,
  }) + "\n";
}

function ownerToken(text: string): string | undefined {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null || !("token" in value)) return undefined;
    return typeof value.token === "string" ? value.token : undefined;
  } catch {
    return undefined;
  }
}

function lockCode(error: unknown): string {
  if (!(error instanceof Error) || !("code" in error)) return "";
  const code = error.code;
  return typeof code === "string" ? code : "";
}

async function tryCreateLock(path: string, body: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(path, "wx");
    await handle.writeFile(body);
    await handle.close();
    return true;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (handle !== undefined) {
      await rm(path, { force: true });
      throw error;
    }
    // Windows reports EPERM while another holder's lock file is pending delete.
    if (lockCode(error) !== "EEXIST" && lockCode(error) !== "EPERM") throw error;
    return false;
  }
}

async function snapshot(path: string): Promise<Snapshot | null> {
  try {
    const info = await stat(path);
    return { text: await readFile(path, "utf8"), mtimeMs: info.mtimeMs };
  } catch (error) {
    if (lockCode(error) === "ENOENT") return null;
    throw error;
  }
}

function sleep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, pollMs));
}

async function waitForLock(path: string, deadline: number): Promise<void> {
  if (Date.now() >= deadline) {
    throw new RelayError("lock", "run lock timed out", "locks/run.lock");
  }
  const seen = await snapshot(path);
  if (seen === null) return;
  if (Date.now() - seen.mtimeMs >= staleLockMs) {
    await breakStaleLock(path, seen);
    return;
  }
  await sleep();
}

// Only one process breaks a stale lock at a time, and only the lock it saw as stale.
async function breakStaleLock(path: string, seen: Snapshot): Promise<void> {
  const breakPath = `${path}.break`;
  if (!(await tryCreateLock(breakPath, lockBody(randomBytes(16).toString("hex"))))) {
    const held = await snapshot(breakPath);
    if (held !== null && Date.now() - held.mtimeMs >= staleLockMs) {
      await rm(breakPath, { force: true });
    }
    await sleep();
    return;
  }
  try {
    const current = await snapshot(path);
    if (current?.text === seen.text && current.mtimeMs === seen.mtimeMs) {
      await rm(path, { force: true });
    }
  } finally {
    await rm(breakPath, { force: true });
  }
}
