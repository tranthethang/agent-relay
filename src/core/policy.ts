import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { fromZod, RelayError } from "./error.js";

const execFileAsync = promisify(execFile);

export const policySchema = z.object({
  schema: z.literal(1),
  requireReviews: z.array(z.enum(["self", "cross"])).min(1)
    .refine((items) => new Set(items).size === items.length, "review kinds must be unique"),
  smallChange: z.number().int().nonnegative(),
  testCommand: z.string().optional(),
}).strict();

export type Policy = z.infer<typeof policySchema>;

export const defaultPolicy: Policy = {
  schema: 1,
  requireReviews: ["self", "cross"],
  smallChange: 20,
};

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
