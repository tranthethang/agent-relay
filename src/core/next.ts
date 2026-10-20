import { type EventLine } from "./event.js";
import { type RunState } from "./reduce.js";
import { openPlanTasks, type PlanIndex } from "./tasks.js";
import { schemaVersion } from "./vocab.js";

export type NextAction = {
  command: string;
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
): string {
  const early = nextBeforeReview(id, state, index);
  if (early !== undefined) return early;
  if (lastStageAction(events, "self-review") === "started") return `atry review done ${id} self`;
  if (lastStageAction(events, "cross-review") === "started") return `atry review done ${id} cross`;
  if (reviews !== undefined) return nextFromReviews(id, events, reviews);
  return nextWithoutReviews(id, events);
}

function nextBeforeReview(
  id: string,
  state: RunState,
  index?: PlanIndex | null,
): string | undefined {
  if (state.lifecycle === "abandoned" || state.lifecycle === "closed") return "none";
  if (state.lifecycle === "planned") return `atry approve ${id}`;
  if (state.lifecycle === "approved") return `atry stage start ${id} implement`;
  if (state.lifecycle !== "implementing") return undefined;
  if (openPlanTasks(index ?? null, state).length > 0) return `atry task start ${id}`;
  return `atry stage done ${id} implement`;
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
): string[] {
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
  if (commands.length === 0) return [`atry close ${id} --preview`];
  if (!commands.includes(recommendation)) commands.unshift(recommendation);
  commands.push(`atry close ${id} --preview`);
  return [...new Set(commands)];
}

export function nextActions(
  id: string,
  state: RunState,
  events: readonly EventLine[],
  recommendation: string,
  reviews?: { required: readonly string[]; done: readonly string[] },
  index?: PlanIndex | null,
): string[] {
  if (state.lifecycle === "closed" || state.lifecycle === "abandoned") return [];
  if (state.lifecycle === "implementing") {
    return nextImplementingActions(id, state, recommendation, index);
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

function actionReadPaths(command: string, task?: string): string[] {
  if (command.includes(" approve ")) {
    return ["10-plan/overview.md"];
  }
  if (task !== undefined) {
    return ["10-plan/overview.md", `10-plan/${task}.md`];
  }
  return [];
}

function actionFor(command: string): NextAction {
  const needsHuman = /\b(approve|close|decide)\b/.test(command);
  const match = /\btask start \S+ (T[1-9]\d*)$/.exec(command);
  const task = match?.[1];
  const read = actionReadPaths(command, task);
  return {
    command,
    reason: reasonFor(command),
    needsHuman,
    read,
  };
}

function reasonFor(command: string): string {
  if (command === "none") return "The run is closed or abandoned.";
  if (command.includes(" approve ")) return "The plan is waiting for approval.";
  if (command.includes(" stage start ")) return "Implement has not started.";
  if (command.includes(" task start ")) return "An implement task is still open.";
  if (command.includes(" stage done ")) return "Every implement task is done or skipped.";
  if (command.includes(" review new ") && command.endsWith(" self")) {
    return "Self-review has not started.";
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
  if (command.includes(" decide ")) return "A review question is still open.";
  if (command.includes(" close ")) return "The run is ready for a developer close decision.";
  return "The next command comes from the run state.";
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
