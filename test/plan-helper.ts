import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCli } from "./helper.js";

export async function createRun(dir: string, slug: string): Promise<string> {
  const created = await runCli(
    ["run", "new", "--slug", slug, "--title", slug, "--json"],
    dir,
  );
  if (created.code !== 0) throw new Error(created.stderr || created.stdout);
  return (JSON.parse(created.stdout) as { path: string }).path;
}

export function taskInput(
  tasks: { title: string; deps?: string[]; files?: string[] }[],
): string {
  return `${
    JSON.stringify({
      schema: 1,
      tasks: tasks.map((task) => ({
        title: task.title,
        deps: task.deps ?? [],
        files: task.files ?? [],
      })),
    })
  }\n`;
}

export async function writeTasks(
  run: string,
  tasks: { title: string; deps?: string[]; files?: string[] }[],
): Promise<void> {
  await writeFile(join(run, "10-plan", "tasks.input.json"), taskInput(tasks));
}
