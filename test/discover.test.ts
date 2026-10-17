import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { findRelayDir, resolveRun } from "../src/core/discover.js";
import { brainstormDirNamePattern } from "../src/core/vocab.js";
import { withTempDir } from "./helper.js";

const runA = "20261017-1792208724-next-core-schemas";
const runB = "20261017-1792208725-next-state-cli-base";
const sameSlug = "20261018-1792208726-next-core-schemas";

async function seed(root: string): Promise<string> {
  const relay = join(root, ".agent-relay");
  await mkdir(join(relay, runA), { recursive: true });
  await mkdir(join(relay, runB), { recursive: true });
  await mkdir(join(relay, sameSlug), { recursive: true });
  await mkdir(join(relay, "brainstorms", "20261017-agent-relay-v2"), { recursive: true });
  await writeFile(join(relay, "notes.txt"), "x\n", "utf8");
  await mkdir(join(root, "nested", "cwd"), { recursive: true });
  return relay;
}

test("findRelayDir walks up from cwd", async () => {
  await withTempDir(async (root) => {
    const relay = await seed(root);
    expect(await findRelayDir(join(root, "nested", "cwd"))).toBe(relay);
    expect(await findRelayDir(relay)).toBe(relay);
  });
});

test("resolveRun accepts an id, a unique slug, a dirname, and a path", async () => {
  await withTempDir(async (root) => {
    const relay = await seed(root);
    const cwd = join(root, "nested", "cwd");
    expect(await resolveRun(relay, "1792208725", cwd)).toBe(join(relay, runB));
    expect(await resolveRun(relay, "next-state-cli-base", cwd)).toBe(join(relay, runB));
    expect(await resolveRun(relay, runA, cwd)).toBe(join(relay, runA));
    expect(await resolveRun(relay, join(relay, runA), cwd)).toBe(join(relay, runA));
  });
});

test("resolveRun reports an ambiguous slug and a missing run", async () => {
  await withTempDir(async (root) => {
    const relay = await seed(root);
    await expect(resolveRun(relay, "next-core-schemas", root)).rejects.toMatchObject({
      code: "ambiguous",
      exitCode: 3,
    });
    await expect(resolveRun(relay, "1792209999", root)).rejects.toMatchObject({
      code: "not_found",
      exitCode: 3,
    });
    await expect(resolveRun(relay, "agent-relay-v2", root)).rejects.toMatchObject({
      code: "not_found",
      exitCode: 3,
    });
  });
});

test("resolveRun ignores a cwd directory that shares the slug name", async () => {
  await withTempDir(async (root) => {
    const relay = await seed(root);
    await mkdir(join(root, "next-state-cli-base"), { recursive: true });
    expect(await resolveRun(relay, "next-state-cli-base", root)).toBe(join(relay, runB));
  });
});

test("findRelayDir fails when no relay directory exists", async () => {
  await withTempDir(async (root) => {
    await expect(findRelayDir(root)).rejects.toMatchObject({ code: "not_found", exitCode: 3 });
  });
});

test("findRelayDir stops at the git root", async () => {
  await withTempDir(async (root) => {
    await mkdir(join(root, ".agent-relay", "bin"), { recursive: true });
    await mkdir(join(root, "proj", ".git"), { recursive: true });
    await mkdir(join(root, "proj", "sub"), { recursive: true });
    await expect(findRelayDir(join(root, "proj", "sub"))).rejects.toMatchObject({
      code: "not_found",
      exitCode: 3,
    });
    await mkdir(join(root, "proj", ".agent-relay"));
    expect(await findRelayDir(join(root, "proj", "sub"))).toBe(join(root, "proj", ".agent-relay"));
  });
});

test("brainstorm directory names allow digits in the slug", () => {
  expect(brainstormDirNamePattern.test("20261017-agent-relay-v2")).toBe(true);
  expect(brainstormDirNamePattern.test("20261017-Agent")).toBe(false);
});
