import { type EventLine } from "./event.js";
import { type RunState } from "./reduce.js";
import { crossDeltaNeedsSelfReview } from "./review.js";
import { openPlanTasks, type PlanIndex } from "./tasks.js";
import { schemaVersion } from "./vocab.js";

export const actionKinds = [
  "approve",
  "stage-start",
  "task-start",
  "integrate",
  "stage-done",
  "review-new",
  "review-done",
  "close",
  "decide",
  "none",
] as const;

export type ActionKind = (typeof actionKinds)[number];

export type NextActionArgs = {
  run?: string;
  stage?: "implement";
  task?: string;
  review?: "self" | "cross";
};

export type NextAction = {
  kind: ActionKind;
  command: string;
  args: NextActionArgs;
  requiresModel?: true;
  requiresSession?: true;
  reason: string;
  needsHuman: boolean;
  read: string[];
};

export type NextResult = {
  schema: typeof schemaVersion;
  command: string;
  recommendation: string;
  state?: { stage: RunState["stage"]; lifecycle: RunState["lifecycle"]; approved: boolean };
  actions: NextAction[];
  reason: string;
  needsHuman: boolean;
  read: string[];
};

export function formatAge(fromMs: number, nowMs: number): string {
  const ms = Math.max(0, nowMs - fromMs);
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function nextStep(
  id: string,
  state: RunState,
  events: readonly EventLine[],
  reviews?: { required: readonly string[]; done: readonly string[] },
  index?: PlanIndex | null,
  integrateTasks: readonly string[] = [],
): string {
  const early = nextBeforeReview(id, state, index, integrateTasks);
  if (early !== undefined) return early;
  if (lastStageAction(events, "self-review") === "started") return `atry review done ${id} self`;
  if (lastStageAction(events, "cross-review") === "started") return `atry review done ${id} cross`;
  if (crossDeltaNeedsSelfReview(events)) return `atry review new ${id} self`;
  if (reviews !== undefined) return nextFromReviews(id, events, reviews);
  return nextWithoutReviews(id, events);
}

function nextBeforeReview(
  id: string,
  state: RunState,
  index: PlanIndex | null | undefined,
  integrateTasks: readonly string[],
): string | undefined {
  if (state.lifecycle === "abandoned" || state.lifecycle === "closed") return "none";
  if (state.lifecycle === "planned") return `atry approve ${id}`;
  if (state.lifecycle === "approved") return `atry stage start ${id} implement`;
  if (state.lifecycle !== "implementing") return undefined;
  const integrate = integrateCommands(id, state, index, integrateTasks);
  const command = integrate[0];
  if (command !== undefined) return command;
  if (openPlanTasks(index ?? null, state).length > 0) return `atry task start ${id}`;
  return `atry stage done ${id} implement`;
}

function integrateCommands(
  id: string,
  state: RunState,
  index: PlanIndex | null | undefined,
  tasks: readonly string[],
): string[] {
  if (tasks.length === 0) return [];
  const status = new Map(state.tasks.map((task) => [task.id, task.status]));
  const deps = new Map((index?.tasks ?? []).map((task) => [task.id, task.deps]));
  const commands: string[] = [];
  for (const task of tasks) {
    if ((status.get(task) ?? "pending") !== "done") continue;
    const ready = (deps.get(task) ?? []).every((dep) => {
      const value = status.get(dep) ?? "pending";
      return value === "done" || value === "skipped";
    });
    if (ready) commands.push(`atry integrate ${id} ${task}`);
  }
  return commands;
}

function nextFromReviews(
  id: string,
  events: readonly EventLine[],
  reviews: { required: readonly string[]; done: readonly string[] },
): string {
  if (reviews.required.includes("self") && !reviews.done.includes("self")) {
    return reviewCommand(id, events, "self");
  }
  if (reviews.required.includes("cross") && !reviews.done.includes("cross")) {
    return reviewCommand(id, events, "cross");
  }
  return `atry close ${id}`;
}

function nextWithoutReviews(id: string, events: readonly EventLine[]): string {
  if (lastStageAction(events, "self-review") !== "completed") {
    return reviewCommand(id, events, "self");
  }
  if (lastStageAction(events, "cross-review") !== "completed") {
    return reviewCommand(id, events, "cross");
  }
  return `atry close ${id}`;
}

function reviewCommand(
  id: string,
  events: readonly EventLine[],
  kind: "self" | "cross",
): string {
  const stage = kind === "self" ? "self-review" : "cross-review";
  const verb = lastStageAction(events, stage) === "started" ? "done" : "new";
  return `atry review ${verb} ${id} ${kind}`;
}

export function explainNext(command: string): NextResult {
  return explainNextWithChoices(command);
}

function nextImplementingActions(
  id: string,
  state: RunState,
  recommendation: string,
  index?: PlanIndex | null,
  integrateTasks: readonly string[] = [],
): string[] {
  const integrate = integrateCommands(id, state, index, integrateTasks);
  if (integrate.length > 0) return integrate;
  if (index === undefined || index === null) {
    if (recommendation.includes("task start")) return [`atry list ${id}`];
    return [recommendation];
  }
  const status = new Map(state.tasks.map((task) => [task.id, task.status]));
  const eligible = index.tasks.filter((task) =>
    (status.get(task.id) ?? "pending") === "pending"
    && task.deps.every((dep) => {
      const value = status.get(dep) ?? "pending";
      return value === "done" || value === "skipped";
    })
  ).map((task) => `atry task start ${id} ${task.id}`);
  if (eligible.length > 0) return eligible;
  if (openPlanTasks(index, state).length > 0) return [`atry list ${id}`];
  return [recommendation];
}

function nextReviewingActions(
  id: string,
  events: readonly EventLine[],
  recommendation: string,
  reviews?: { required: readonly string[]; done: readonly string[] },
): string[] {
  const currentReview = ["self-review", "cross-review"].find((stage) =>
    lastStageAction(events, stage as EventLine["stage"]) === "started"
  );
  if (currentReview !== undefined) return [recommendation];
  if (reviews === undefined) return [recommendation];
  const missing = reviews.required.filter((kind) => !reviews.done.includes(kind));
  const commands = missing.map((kind) => `atry review new ${id} ${kind}`);
  const close = `atry close ${id} --preview`;
  if (commands.length === 0) {
    // A cross-review delta asks for a self-review even when policy is satisfied.
    return recommendation.includes(" review ") ? [recommendation, close] : [close];
  }
  if (!commands.includes(recommendation)) commands.unshift(recommendation);
  commands.push(close);
  return [...new Set(commands)];
}

export function nextActions(
  id: string,
  state: RunState,
  events: readonly EventLine[],
  recommendation: string,
  reviews?: { required: readonly string[]; done: readonly string[] },
  index?: PlanIndex | null,
  integrateTasks: readonly string[] = [],
): string[] {
  if (state.lifecycle === "closed" || state.lifecycle === "abandoned") return [];
  if (state.lifecycle === "implementing") {
    return nextImplementingActions(id, state, recommendation, index, integrateTasks);
  }
  if (state.lifecycle === "reviewing") {
    return nextReviewingActions(id, events, recommendation, reviews);
  }
  return [recommendation];
}

export function explainNextWithChoices(
  command: string,
  state?: RunState,
  choices: readonly string[] = [command],
): NextResult {
  const actions = choices.map((item) => actionFor(item));
  const recommendation = actions[0]?.command ?? command;
  const result: NextResult = {
    schema: schemaVersion,
    command: recommendation,
    recommendation,
    actions,
    reason: reasonFor(recommendation),
    needsHuman: actions.length > 1 || (actions[0]?.needsHuman ?? false),
    read: actions[0]?.read ?? [],
  };
  if (state !== undefined) {
    result.state = {
      stage: state.stage,
      lifecycle: state.lifecycle,
      approved: state.approved,
    };
  }
  return result;
}

export function nextText(result: NextResult): string {
  const state = result.state === undefined
    ? "state: unknown"
    : `state: ${result.state.stage}/${result.state.lifecycle} approved=${result.state.approved}`;
  const actions = result.actions.length === 0
    ? "actions: none"
    : `actions:\n${
      result.actions.map((action) =>
        `- ${action.command} — ${action.reason}${action.needsHuman ? " (developer decision)" : ""}`
      ).join("\n")
    }`;
  return `${state}\nrecommendation: ${result.recommendation}\n${actions}\n`;
}

function actionReadPaths(kind: ActionKind, args: NextActionArgs): string[] {
  switch (kind) {
    case "approve":
      return ["10-plan/overview.md"];
    case "task-start":
    case "integrate":
      return args.task === undefined
        ? ["10-plan/overview.md"]
        : ["10-plan/overview.md", `10-plan/${args.task}.md`];
    case "stage-start":
    case "stage-done":
      return ["10-plan/overview.md", "10-plan/index.json"];
    case "review-new":
    case "review-done":
      return args.review === "cross"
        ? ["10-plan/overview.md", "20-implement/", "30-self-review/"]
        : ["10-plan/overview.md", "20-implement/"];
    case "decide":
      return ["30-self-review/", "40-cross-review/"];
    case "close":
      return ["10-plan/overview.md", "30-self-review/", "40-cross-review/"];
    case "none":
      // A closed run has nothing to read. `atry list` reports blocked tasks.
      return args.run === undefined ? [] : ["10-plan/index.json"];
  }
}

function actionKind(command: string): ActionKind {
  if (command === "none") return "none";
  if (/\bapprove\b/.test(command)) return "approve";
  if (/\bstage start\b/.test(command)) return "stage-start";
  if (/\bstage done\b/.test(command)) return "stage-done";
  if (/\btask start\b/.test(command)) return "task-start";
  if (/\bintegrate\b/.test(command)) return "integrate";
  if (/\breview new\b/.test(command)) return "review-new";
  if (/\breview done\b/.test(command)) return "review-done";
  if (/\breview decide\b/.test(command)) return "decide";
  if (/\bclose\b/.test(command)) return "close";
  // `atry list` reads the tasks. It changes nothing, so no action is available.
  return "none";
}

function actionArgs(kind: ActionKind, command: string): NextActionArgs {
  const args: NextActionArgs = {};
  const run = /\b(\d{10,11})\b/.exec(command)?.[1];
  if (run !== undefined) args.run = run;
  if (kind === "task-start" || kind === "integrate") {
    const pattern = kind === "integrate"
      ? /\bintegrate \S+ (T[1-9]\d*)\b/
      : /\btask start \S+ (T[1-9]\d*)\b/;
    const task = pattern.exec(command)?.[1];
    if (task !== undefined) args.task = task;
  }
  if (kind === "stage-start" || kind === "stage-done") args.stage = "implement";
  if (kind === "review-new" || kind === "review-done") {
    if (command.endsWith(" self")) args.review = "self";
    if (command.endsWith(" cross")) args.review = "cross";
  }
  return args;
}

function actionNeedsHuman(kind: ActionKind): boolean {
  return kind === "approve" || kind === "close" || kind === "decide";
}

function actionFor(command: string): NextAction {
  const kind = actionKind(command);
  const args = actionArgs(kind, command);
  const action: NextAction = {
    kind,
    command,
    args,
    reason: reasonFor(command),
    needsHuman: actionNeedsHuman(kind),
    read: actionReadPaths(kind, args),
  };
  if (kind === "review-new" && args.review === "cross") action.requiresModel = true;
  if (kind === "task-start") action.requiresSession = true;
  return action;
}

function reasonFor(command: string): string {
  if (command === "none") return "The run is closed or abandoned.";
  if (command.includes(" approve ")) return "The plan is waiting for approval.";
  if (command.includes(" stage start ")) return "Implement has not started.";
  if (command.includes(" task start ")) return "An implement task is still open.";
  if (command.includes(" integrate ")) return "A done task still has a worktree.";
  if (command.includes(" stage done ")) return "Every implement task is done or skipped.";
  const reviewReason = reasonForReview(command);
  if (reviewReason !== undefined) return reviewReason;
  if (command.includes(" decide ")) return "A review question is still open.";
  if (command.includes(" close ")) return "The run is ready for a developer close decision.";
  if (/\blist\b/.test(command)) return "No pending task is ready to start.";
  return "The next command comes from the run state.";
}

function reasonForReview(command: string): string | undefined {
  if (command.includes(" review new ") && command.endsWith(" self")) {
    return "No self-review covers the current tree.";
  }
  if (command.includes(" review done ") && command.endsWith(" self")) {
    return "Self-review has started.";
  }
  if (command.includes(" review new ") && command.endsWith(" cross")) {
    return "Cross-review has not started.";
  }
  if (command.includes(" review done ") && command.endsWith(" cross")) {
    return "Cross-review has started.";
  }
  return undefined;
}

function lastStageAction(
  events: readonly EventLine[],
  stage: EventLine["stage"],
): "started" | "completed" | undefined {
  let last: "started" | "completed" | undefined;
  for (const event of events) {
    if (event.stage !== stage) continue;
    if (event.action === "started" || event.action === "completed") last = event.action;
  }
  return last;
}
