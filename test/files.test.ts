import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RelayError } from "../src/core/error.js";
import { appendJsonl, atomicWrite, joinUnder, readJsonl, readText } from "../src/core/files.js";
import { withTempDir } from "./helper.js";

test("joinUnder joins parts and rejects a path that escapes", () => {
  const root = join("/tmp", "relay-root");
  expect(joinUnder(root, "locks", "T1.lock")).toBe(join(root, "locks", "T1.lock"));
  expect(() => joinUnder(root, "..", "outside")).toThrow(RelayError);
  expect(() => joinUnder(root, "locks", "../../outside")).toThrow(RelayError);
});

test("atomicWrite replaces a file and leaves no temp file", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "run.json");
    await atomicWrite(filePath, "one\n");
    await atomicWrite(filePath, "two\n");
    expect(await readText(filePath)).toBe("two\n");
    const names = await readdir(dir);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

test("atomicWrite keeps the target when the rename fails", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "run.json");
    await mkdir(filePath);
    await writeFile(join(filePath, "keep"), "x\n", "utf8");
    await expect(atomicWrite(filePath, "new\n")).rejects.toThrow();
    expect(await readText(join(filePath, "keep"))).toBe("x\n");
    const names = await readdir(dir);
    expect(names.filter((name) => name.includes(".tmp"))).toEqual([]);
  });
});

test("appendJsonl and readJsonl keep CRLF files as one record per line", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "events.jsonl");
    await appendJsonl(filePath, "{\"schema\":1}");
    await writeFile(filePath, "{\"schema\":1}\r\n{\"schema\":2}\r\n", "utf8");
    expect(await readJsonl(filePath)).toEqual([{ schema: 1 }, { schema: 2 }]);
    await expect(appendJsonl(filePath, "a\nb")).rejects.toBeInstanceOf(RelayError);
  });
});

test("readText turns CRLF and CR into LF", async () => {
  await withTempDir(async (dir) => {
    const filePath = join(dir, "note.txt");
    await writeFile(filePath, "a\r\nb\rc\n", "utf8");
    expect(await readText(filePath)).toBe("a\nb\nc\n");
  });
});
