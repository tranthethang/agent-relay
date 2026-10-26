import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { parsePolicy } from "../src/core/policy.js";

const pointer = "See the \"Dogfood policy\" section of CONTRIBUTING.md.";

test("the repo policy keeps strict.scope on and names a testCommand", async () => {
  const policy = parsePolicy(
    await readFile(new URL("../.agent-relay.json", import.meta.url), "utf8"),
  );
  expect(policy.strict?.scope, `strict.scope must be true. ${pointer}`).toBe(true);
  const command = policy.testCommand;
  expect(command !== undefined && command.trim().length > 0, `testCommand is missing. ${pointer}`)
    .toBe(true);
});
