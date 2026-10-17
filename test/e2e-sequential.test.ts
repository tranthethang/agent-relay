import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { mustCli } from "./e2e.js";
import { gitCommit, withTempGitRepo } from "./helper.js";

const tasksInput = {
  schema: 1,
  tasks: [{ title: "Add the note", deps: [], files: ["src/note.ts"] }],
};

const review = {
  schema: 1,
  kind: "self",
  tool: "cursor",
  model: "unknown",
  fixed: 0,
  tests: "pass",
  open: [],
};

test("a sequential run moves from run new to close", async () => {
  await withTempGitRepo(async (dir) => {
    await gitCommit(dir);
    const created = await mustCli(
      ["run", "new", "--slug", "seq-cutover", "--title", "Sequential", "--json"],
      dir,
    );
    const run = (JSON.parse(created.stdout) as { path: string }).path;
    await mustCli(["plan", "new", run], dir);
    await writeFile(
      join(run, "10-plan", "overview.md"),
      "# Overview\n\n## Goal\n\nShip the note.\n",
    );
    await writeFile(join(run, "10-plan", "tasks.input.json"), `${JSON.stringify(tasksInput)}\n`);
    const planned = await mustCli(["plan", "done", run, "--json"], dir);
    expect(JSON.parse(planned.stdout)).toMatchObject({ tasks: ["T1"] });
    await mustCli(["approve", run, "--via", "arg"], dir);
    await mustCli(["stage", "start", run, "implement", "--tool", "cursor"], dir);
    await mustCli(["task", "start", run, "T1"], dir);
    await writeFile(join(run, "20-implement", "T1.md"), "# T1\n\nFiles: src/note.ts\n");
    await mustCli(["task", "done", run, "T1"], dir);
    const implemented = await mustCli(
      ["stage", "done", run, "implement", "--tool", "cursor", "--json"],
      dir,
    );
    expect(JSON.parse(implemented.stdout)).toMatchObject({ lifecycle: "reviewing" });

    await mustCli(["review", "new", run, "self", "--tool", "cursor", "--model", "unknown"], dir);
    await writeFile(join(run, "30-self-review", "01.json"), `${JSON.stringify(review)}\n`);
    await mustCli(["review", "done", run, "self"], dir);

    await mustCli(["review", "new", run, "cross", "--tool", "codex", "--model", "gpt-5.4"], dir);
    await writeFile(
      join(run, "40-cross-review", "01.json"),
      `${JSON.stringify({ ...review, kind: "cross", tool: "codex", model: "gpt-5.4" })}\n`,
    );
    await mustCli(["review", "done", run, "cross"], dir);

    const closed = await mustCli(["close", run, "--via", "arg", "--json"], dir);
    expect(JSON.parse(closed.stdout)).toMatchObject({ lifecycle: "closed" });
    const status = await mustCli(["status", run, "--json"], dir);
    expect(JSON.parse(status.stdout)).toMatchObject({ lifecycle: "closed" });
    const events = await readFile(join(run, "events.jsonl"), "utf8");
    expect(events).toContain("\"action\":\"closed\"");
  });
});
