import { join } from "node:path";
import { RelayError } from "./error.js";
import { type EventLine } from "./event.js";
import { readJson } from "./files.js";
import { appendEvent, withRunLock } from "./mutate.js";
import { parseReviewJson, reviewPlaces } from "./review.js";
import { schemaVersion } from "./vocab.js";

export type DecideResult = {
  schema: 1;
  path: string;
  review: string;
  question: string;
  answer: string;
  action: "decided";
};

export function decideText(result: DecideResult): string {
  return `review: ${result.review}\nquestion: ${result.question}\nanswer: ${result.answer}\naction: ${result.action}\n`;
}

export async function decideQuestion(input: {
  runDir: string;
  questionId: string;
  answer: string;
}): Promise<DecideResult> {
  const questionMatch = /^Q([1-9]\d*)$/.exec(input.questionId);
  if (questionMatch?.[1] === undefined) {
    throw new RelayError("validation", "invalid question id", "question");
  }
  const index = Number(questionMatch[1]) - 1;
  const answer = input.answer.trim();
  if (answer.length === 0) throw new RelayError("validation", "answer is empty", "answer");
  return withRunLock(input.runDir, async (loaded) => {
    const completed = latestCompletedReview(loaded.events);
    if (completed?.ref === undefined || completed.stage === undefined) {
      throw new RelayError("not_found", "completed review not found", "review");
    }
    const location = reviewPlaces[completed.stage === "self-review" ? "self" : "cross"];
    if (!new RegExp(String.raw`^${location.dir}/\d+\.json$`).test(completed.ref)) {
      throw new RelayError("validation", "invalid review ref", completed.ref);
    }
    let reviewValue: unknown;
    try {
      reviewValue = await readJson(join(input.runDir, completed.ref));
    } catch {
      throw new RelayError("validation", "could not read completed review", completed.ref);
    }
    let review;
    try {
      review = parseReviewJson(reviewValue);
    } catch {
      throw new RelayError("validation", "invalid completed review", completed.ref);
    }
    const item = review.open[index];
    if (item === undefined) {
      throw new RelayError("validation", "question id is outside the open list", "question");
    }
    const isChoice = "a" in item;
    if (isChoice && answer !== "a" && answer !== "b") {
      throw new RelayError("validation", "choice answer must be a or b", "answer");
    }
    if (
      loaded.events.some((event) =>
        event.action === "decided" && event.ref === completed.ref && event.question === item.q
      )
    ) {
      throw new RelayError("validation", "question already decided", "question");
    }
    await appendEvent(loaded, input.runDir, {
      stage: completed.stage,
      action: "decided",
      question: item.q,
      answer,
      ref: completed.ref,
    });
    return {
      schema: schemaVersion,
      path: input.runDir,
      review: completed.ref,
      question: item.q,
      answer,
      action: "decided",
    };
  });
}

function latestCompletedReview(events: readonly EventLine[]): EventLine | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event?.action === "completed"
      && (event.stage === "self-review" || event.stage === "cross-review")
    ) return event;
  }
  return undefined;
}
