import { type EventLine } from "./event.js";
import { type RunState } from "./reduce.js";
import { schemaVersion } from "./vocab.js";

export type NextResult = {
  schema: typeof schemaVersion;
  command: string;
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
): string {
  if (state.lifecycle === "abandoned" || state.lifecycle === "closed") return "none";
  if (state.lifecycle === "planned") return `atry approve ${id}`;
  if (state.lifecycle === "approved") return `atry stage start ${id} implement`;
  if (state.lifecycle === "implementing") {
    const open = state.tasks.some((task) =>
      task.status === "pending" || task.status === "in-progress"
    );
    if (open) return `atry task start ${id}`;
    return `atry stage done ${id} implement`;
  }
  if (lastStageAction(events, "self-review") === "started") return `atry review done ${id} self`;
  if (lastStageAction(events, "cross-review") === "started") return `atry review done ${id} cross`;
  if (reviews !== undefined) {
    if (reviews.required.includes("self") && !reviews.done.includes("self")) {
      return lastStageAction(events, "self-review") === "started"
        ? `atry review done ${id} self`
        : `atry review new ${id} self`;
    }
    if (reviews.required.includes("cross") && !reviews.done.includes("cross")) {
      return lastStageAction(events, "cross-review") === "started"
        ? `atry review done ${id} cross`
        : `atry review new ${id} cross`;
    }
    return `atry close ${id}`;
  }
  if (lastStageAction(events, "self-review") !== "completed") {
    if (lastStageAction(events, "self-review") === "started") return `atry review done ${id} self`;
    return `atry review new ${id} self`;
  }
  if (lastStageAction(events, "cross-review") === "started") return `atry review done ${id} cross`;
  if (lastStageAction(events, "cross-review") !== "completed") return `atry review new ${id} cross`;
  return `atry close ${id}`;
}

export function explainNext(command: string): NextResult {
  return {
    schema: schemaVersion,
    command,
    reason: reasonFor(command),
    needsHuman: /\b(approve|close|decide)\b/.test(command),
    read: command.includes(" approve ") ? ["10-plan/overview.md"] : [],
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
  if (command.includes(" close ")) return "The required reviews are complete.";
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
