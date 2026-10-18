import { type EventLine } from "./event.js";
import { type RunState } from "./reduce.js";

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
  }
  if (lastStageAction(events, "self-review") !== "completed") {
    if (lastStageAction(events, "self-review") === "started") return `atry review done ${id} self`;
    return `atry review new ${id} self`;
  }
  if (lastStageAction(events, "cross-review") === "started") return `atry review done ${id} cross`;
  if (lastStageAction(events, "cross-review") !== "completed") return `atry review new ${id} cross`;
  return `atry close ${id}`;
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
