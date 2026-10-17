import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runCli, withTempGitRepo } from "./helper.js";

test("atry brainstorm new scaffolds notes.md and open.json", async () => {
  await withTempGitRepo(async (dir) => {
    const created = await runCli(["brainstorm", "new", "--slug", "agent-relay-v2", "--json"], dir);
    expect(created.code).toBe(0);
    const body = JSON.parse(created.stdout) as { path: string; notes: string; open: string };
    expect(body.path).toContain(join("brainstorms", "2026"));
    expect(body.path.endsWith("-agent-relay-v2")).toBe(true);
    expect(await readFile(body.notes, "utf8")).toBe("# agent-relay-v2\n");
    expect(JSON.parse(await readFile(body.open, "utf8"))).toEqual({ schema: 1, open: [] });
    const again = await runCli(["brainstorm", "new", "--slug", "agent-relay-v2"], dir);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("slug:");
  });
});

test("atry brainstorm done validates open.json", async () => {
  await withTempGitRepo(async (dir) => {
    const created = await runCli(["brainstorm", "new", "--slug", "open-items", "--json"], dir);
    const body = JSON.parse(created.stdout) as { path: string; open: string };
    const done = await runCli(["brainstorm", "done", body.path], dir);
    expect(done.code).toBe(0);
    expect(done.stdout).toBe("open: 0\n");
    await writeOpen(body.open, {
      schema: 1,
      open: [
        { q: "Which exit code?", a: "Keep 4", b: "Use 2" },
        { q: "Which file?", need: "A sample open.json" },
      ],
    });
    const counted = await runCli(["brainstorm", "done", "--json", body.path], dir);
    expect(counted.code).toBe(0);
    expect(JSON.parse(counted.stdout)).toMatchObject({ open: 2 });
    await writeOpen(body.open, { schema: 1, open: [{ q: "Mixed", a: "A", b: "B", need: "x" }] });
    const invalid = await runCli(["brainstorm", "done", body.path], dir);
    expect(invalid.code).toBe(2);
    expect(invalid.stderr).toContain("open.json:");
  });
});

function writeOpen(path: string, value: unknown): Promise<void> {
  return writeFile(path, `${JSON.stringify(value)}\n`);
}
