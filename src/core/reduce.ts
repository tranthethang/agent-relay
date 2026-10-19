import { type EventLine } from "./event.js";
import { type RunJson } from "./run.js";

export type RunState = RunJson["state"];
export type TaskState = RunState["tasks"][number];

export function initialState(): RunState {
  return {
    lifecycle: "planned",
    stage: "plan",
    approved: false,
    tasks: [],
  };
}

export function reduceEvents(events: readonly EventLine[]): RunState {
  const state = initialState();
  for (const event of events) applyEvent(state, event);
  return state;
}

function applyEvent(state: RunState, event: EventLine): void {
  const terminal = state.lifecycle === "closed" || state.lifecycle === "abandoned";
  applyTask(state, event);
  if (terminal) return;
  applyLifecycle(state, event);
}

function applyLifecycle(state: RunState, event: EventLine): void {
  // A `rebased` run event moves `base` only. It does not change lifecycle, stage, or tasks.
  if (event.action === "waived" || event.action === "rebased") return;
  if (event.action === "abandoned") {
    state.lifecycle = "abandoned";
    return;
  }
  if (event.action === "closed") {
    state.lifecycle = "closed";
    return;
  }
  if (event.action === "created") {
    state.lifecycle = "planned";
    state.stage = event.stage === "run" ? "plan" : event.stage;
    return;
  }
  if (event.action === "approved") {
    applyApproved(state, event);
    return;
  }
  if (event.action === "started") {
    applyStarted(state, event);
    return;
  }
  if (event.action === "completed" && event.stage === "implement") {
    state.stage = event.stage;
    state.lifecycle = "reviewing";
    return;
  }
  if (event.action === "completed") state.stage = event.stage;
}

function applyApproved(state: RunState, event: EventLine): void {
  state.approved = true;
  if (state.lifecycle === "planned") state.lifecycle = "approved";
  state.stage = event.stage;
}

function applyStarted(state: RunState, event: EventLine): void {
  state.stage = event.stage;
  if (event.stage === "implement") state.lifecycle = "implementing";
  if (event.stage === "self-review" || event.stage === "cross-review") {
    state.lifecycle = "reviewing";
  }
}

function applyTask(state: RunState, event: EventLine): void {
  const id = event.task;
  if (id === undefined) return;
  if (event.action === "task-started" || event.action === "claimed" || event.action === "stolen") {
    const task = touch(state, id);
    task.status = "in-progress";
    if (event.session !== undefined) task.session = event.session;
    delete task.reason;
    return;
  }
  if (event.action === "task-done") {
    const task = touch(state, id);
    task.status = "done";
    delete task.session;
    delete task.reason;
    return;
  }
  if (event.action === "task-skipped") {
    const task = touch(state, id);
    task.status = "skipped";
    delete task.session;
    if (event.reason !== undefined) task.reason = event.reason;
    else delete task.reason;
    return;
  }
  if (event.action === "released") {
    delete touch(state, id).session;
  }
}

function touch(state: RunState, id: string): TaskState {
  const found = state.tasks.find((task) => task.id === id);
  if (found !== undefined) return found;
  const task: TaskState = { id, status: "pending" };
  state.tasks.push(task);
  return task;
}
