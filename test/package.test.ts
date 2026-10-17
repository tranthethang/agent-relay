import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  name: string;
  version: string;
  type: string;
  repository: { url: string };
  bin: { atry: string };
  engines: { node: string };
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

test("package.json matches the P1 package contract", () => {
  expect(pkg.name).toBe("@tranthethang/agent-relay");
  expect(pkg.type).toBe("module");
  // npm provenance rejects the publish when repository.url does not match the GitHub repo.
  expect(pkg.repository.url).toBe("git+https://github.com/tranthethang/agent-relay.git");
  expect(pkg.bin.atry).toBe("dist/atry.js");
  expect(pkg.engines.node).toBe(">=22");
  expect(Object.keys(pkg.dependencies).sort()).toEqual(["commander", "zod"]);
  expect(Object.keys(pkg.devDependencies).sort()).toEqual([
    "@types/node",
    "tsup",
    "typescript",
    "vitest",
  ]);
  expect(pkg.version).toBe("0.0.0");
});
