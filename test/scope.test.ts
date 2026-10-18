import { expect, test } from "vitest";
import { outsidePaths } from "../src/core/scope.js";

test("outsidePaths keeps covered paths and drops run files", () => {
  expect(outsidePaths(
    ["src/own.ts", "src/dir/nested.ts", "src\\peer.ts", ".agent-relay/run/events.jsonl"],
    ["src/own.ts", "src/dir"],
    ["src/peer.ts"],
  )).toEqual([]);
  expect(outsidePaths(["src/other.ts", "src/own.ts"], ["src/own.ts"], [])).toEqual([
    "src/other.ts",
  ]);
});
