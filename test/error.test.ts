import { expect, test } from "vitest";
import { z } from "zod";
import { errorJson, errorText, exitCodes, fromZod, RelayError } from "../src/core/error.js";

test("exit codes match the plan", () => {
  expect(exitCodes.ok).toBe(0);
  expect(exitCodes.usage).toBe(1);
  expect(exitCodes.validation).toBe(2);
  expect(exitCodes.not_found).toBe(3);
  expect(exitCodes.ambiguous).toBe(3);
  expect(exitCodes.gate).toBe(4);
  expect(exitCodes.lock).toBe(5);
});

test("fromZod maps the first issue to a field path", () => {
  const schema = z.object({
    tasks: z.array(z.object({ deps: z.array(z.string().regex(/^T[1-9][0-9]*$/)) })),
  });
  const parsed = schema.safeParse({
    tasks: [{ deps: ["T1"] }, { deps: ["T1"] }, { deps: ["nope"] }],
  });
  expect(parsed.success).toBe(false);
  if (parsed.success) return;
  const error = fromZod(parsed.error);
  expect(error).toBeInstanceOf(RelayError);
  expect(error.code).toBe("validation");
  expect(error.exitCode).toBe(2);
  expect(error.fieldPath).toBe("tasks[2].deps[0]");
  expect(errorText(error)).toBe(`${error.fieldPath}: ${error.message}\n`);
  expect(errorJson(error)).toBe(
    `${
      JSON.stringify({
        schema: 1,
        error: { code: "validation", message: error.message, path: "tasks[2].deps[0]" },
      })
    }\n`,
  );
});

test("errorText omits the path when it is empty", () => {
  const error = new RelayError("gate", "plan not approved");
  expect(error.exitCode).toBe(4);
  expect(errorText(error)).toBe("plan not approved\n");
  expect(JSON.parse(errorJson(error))).toEqual({
    schema: 1,
    error: { code: "gate", message: "plan not approved", path: "" },
  });
});
