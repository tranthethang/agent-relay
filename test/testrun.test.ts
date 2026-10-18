import { expect, test } from "vitest";
import { runTestCommand } from "../src/core/testrun.js";

test("runTestCommand records a passing command", async () => {
  const result = await runTestCommand(process.cwd(), `node -e "process.stdout.write('ok')"`);
  expect(result.tests).toMatchObject({ exit: 0 });
  expect(result.stdout).toBe("ok");
});

test("runTestCommand records a failing command", async () => {
  const result = await runTestCommand(process.cwd(), `node -e "process.exit(7)"`);
  expect(result.tests).toMatchObject({ exit: 7 });
});

test("runTestCommand marks a missing command as not configured", async () => {
  expect(await runTestCommand(process.cwd(), undefined)).toEqual({
    tests: "not-configured",
    stdout: "",
    stderr: "",
  });
});

test("runTestCommand keeps a zero exit when output exceeds 1MB", async () => {
  const result = await runTestCommand(
    process.cwd(),
    `node -e "process.stdout.write('x'.repeat(1024*1024+10)); process.stdout.write('\\n')"`,
  );
  expect(result.tests).toMatchObject({ exit: 0 });
  expect(result.stdout.endsWith("x")).toBe(true);
});

test("runTestCommand converts a timeout to exit 124", async () => {
  const result = await runTestCommand(
    process.cwd(),
    `node -e "setTimeout(() => {}, 5000)"`,
    30,
  );
  expect(result.tests).toMatchObject({ exit: 124 });
});

test("runTestCommand timeout stops a child that outlives the shell", async () => {
  const started = Date.now();
  const result = await runTestCommand(
    process.cwd(),
    `node -e "setTimeout(() => {}, 5000)" && node -e "0"`,
    200,
  );
  expect(result.tests).toMatchObject({ exit: 124 });
  expect(Date.now() - started).toBeLessThan(3000);
});
