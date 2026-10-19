import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";
import { isEnoent } from "./files.js";
import { gitRoot } from "./git.js";

const execFileAsync = promisify(execFile);

export const policySchema = z.object({
  schema: z.literal(1),
  requireReviews: z.array(z.enum(["self", "cross"])).min(1)
    .refine((items) => new Set(items).size === items.length, "review kinds must be unique"),
  smallChange: z.number().int().nonnegative(),
  testCommand: z.string().optional(),
  worktree: z.object({
    enabled: z.boolean(),
    dir: z.string().min(1).optional(),
  }).strict().optional(),
}).strict();

export type Policy = z.infer<typeof policySchema>;

export const defaultPolicy: Policy = {
  schema: 1,
  requireReviews: ["self", "cross"],
  smallChange: 20,
};

export const policyTemplate: Policy = {
  ...defaultPolicy,
  requireReviews: [...defaultPolicy.requireReviews],
  worktree: { enabled: false },
};

export type PolicyInitResult = { schema: 1; path: string };

export type PolicyCheckResult = { schema: 1; path: string; policy: Policy };

export async function readPolicy(cwd: string, base: string): Promise<Policy> {
  let text: string;
  try {
    const result = await execFileAsync("git", ["show", `${base}:.agent-relay.json`], {
      cwd,
      // The missing-file check reads git's English message.
      env: { ...process.env, LC_ALL: "C" },
    });
    text = result.stdout;
  } catch (error) {
    const stderr = error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    if (
      stderr.includes(".agent-relay.json")
      && (stderr.includes("does not exist") || stderr.includes("exists on disk, but not in"))
    ) {
      return { ...defaultPolicy, requireReviews: [...defaultPolicy.requireReviews] };
    }
    throw new RelayError("validation", "could not read policy from base", ".agent-relay.json");
  }
  return parsePolicy(text);
}

export function parsePolicy(text: string): Policy {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new RelayError("validation", "invalid JSON", ".agent-relay.json");
  }
  const parsed = policySchema.safeParse(value);
  if (!parsed.success) {
    const issue = fromZod(parsed.error);
    throw new RelayError(
      "validation",
      issue.message,
      issue.fieldPath.length === 0 ? ".agent-relay.json" : `.agent-relay.json:${issue.fieldPath}`,
    );
  }
  return parsed.data;
}

export async function initPolicy(cwd: string): Promise<PolicyInitResult> {
  const path = join(await gitRoot(cwd), ".agent-relay.json");
  try {
    await writeFile(path, `${JSON.stringify(policyTemplate, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      throw new RelayError("gate", ".agent-relay.json already exists", ".agent-relay.json");
    }
    throw error;
  }
  return { schema: 1, path };
}

export async function checkPolicy(cwd: string): Promise<PolicyCheckResult> {
  const path = join(await gitRoot(cwd), ".agent-relay.json");
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      throw new RelayError("not_found", ".agent-relay.json not found", ".agent-relay.json");
    }
    throw error;
  }
  return { schema: 1, path, policy: parsePolicy(text) };
}
