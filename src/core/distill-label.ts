import { type stages } from "./vocab.js";

export const distillKinds = [
  "events",
  "run-cache",
  "plan-overview",
  "plan-tasks-input",
  "plan-index",
  "plan-task",
  "implement-report",
  "review-notes",
  "review-result",
  "test-log",
  "other",
] as const;

export type DistillKind = (typeof distillKinds)[number];

export type PathLabel = {
  kind: DistillKind;
  stage?: (typeof stages)[number];
  task?: string;
};

const fixed: Record<string, PathLabel> = {
  "events.jsonl": { kind: "events" },
  "run.json": { kind: "run-cache" },
  "10-plan/overview.md": { kind: "plan-overview", stage: "plan" },
  "10-plan/tasks.input.json": { kind: "plan-tasks-input", stage: "plan" },
  "10-plan/index.json": { kind: "plan-index", stage: "plan" },
};

const reviewDirs = {
  "30-self-review": "self-review",
  "40-cross-review": "cross-review",
} as const;

const reviewKinds: Record<string, DistillKind> = {
  md: "review-notes",
  json: "review-result",
  "test.log": "test-log",
};

const taskFile = /^(T[1-9]\d*)\.md$/;
const reviewFile = /^\d{2}\.(md|json|test\.log)$/;

// Label one manifest path. `path` uses `/` separators. First match wins.
export function labelPath(path: string): PathLabel {
  if (Object.hasOwn(fixed, path)) return { ...fixed[path] };
  const [dir, name, ...rest] = path.split("/");
  if (name === undefined || rest.length > 0) return { kind: "other" };
  const task = taskFile.exec(name)?.[1];
  if (task !== undefined) {
    if (dir === "10-plan") return { kind: "plan-task", stage: "plan", task };
    if (dir === "20-implement") return { kind: "implement-report", stage: "implement", task };
  }
  if (Object.hasOwn(reviewDirs, dir)) {
    const match = reviewFile.exec(name);
    if (match !== null) {
      return {
        kind: reviewKinds[match[1]],
        stage: reviewDirs[dir as keyof typeof reviewDirs],
      };
    }
  }
  return { kind: "other" };
}
