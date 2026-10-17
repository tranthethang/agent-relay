import { expect, test } from "vitest";
import { renderResult, withWarnings } from "../src/cli/output.js";

test("renderResult prints text and versioned JSON from one object", () => {
  const result = { schema: 1 as const, version: "26.10.16" };
  expect(renderResult(result, false, (row) => `${row.version}\n`)).toBe("26.10.16\n");
  expect(renderResult(result, true, (row) => `${row.version}\n`)).toBe(
    `${JSON.stringify(result)}\n`,
  );
});

test("withWarnings omits an empty warning list", () => {
  const result = { schema: 1 as const, path: "run" };
  expect(withWarnings(result, [])).toEqual(result);
  expect(withWarnings(result, ["rebuilt"])).toEqual({ ...result, warnings: ["rebuilt"] });
});
