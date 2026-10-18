import { expect, test } from "vitest";
import { detectTool } from "../src/core/detect.js";

test("detectTool reads only the supplied environment", () => {
  expect(detectTool({ CODEX_THREAD_ID: "thread-1" })).toBe("codex");
  expect(detectTool({ CODEX_THREAD_ID: "  " })).toBeUndefined();
  expect(detectTool({ CURSOR_TRACE_ID: "cursor-session" })).toBeUndefined();
  expect(detectTool({})).toBeUndefined();
});
