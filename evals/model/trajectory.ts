export type EventPair = { stage: string; action: string };

export type Trajectory = {
  required: EventPair[];
  forbidden: EventPair[];
};

export type TrajectoryResult = {
  pass: boolean;
  matched: number;
  required: number;
  firstMissing: EventPair | null;
  forbiddenHits: EventPair[];
};

export function parseEvents(text: string): EventPair[] {
  const events: EventPair[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`events line ${index + 1} is not JSON`);
    }
    const record = (value ?? {}) as Record<string, unknown>;
    events.push({ stage: String(record.stage ?? ""), action: String(record.action ?? "") });
  }
  return events;
}

function same(pair: EventPair, event: EventPair): boolean {
  return (pair.stage === "*" || pair.stage === event.stage) && pair.action === event.action;
}

export function matchTrajectory(events: EventPair[], trajectory: Trajectory): TrajectoryResult {
  let matched = 0;
  for (const event of events) {
    if (matched < trajectory.required.length && same(trajectory.required[matched], event)) {
      matched += 1;
    }
  }
  const forbiddenHits = trajectory.forbidden.filter((pair) =>
    events.some((event) => same(pair, event))
  );
  const firstMissing = trajectory.required[matched] ?? null;
  return {
    pass: firstMissing === null && forbiddenHits.length === 0,
    matched,
    required: trajectory.required.length,
    firstMissing,
    forbiddenHits,
  };
}
