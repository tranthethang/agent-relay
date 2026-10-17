import { type ZodError, type ZodIssue } from "zod";

export const exitCodes = {
  ok: 0,
  usage: 1,
  validation: 2,
  not_found: 3,
  ambiguous: 3,
  gate: 4,
  lock: 5,
} as const;

export type RelayCode = keyof typeof exitCodes;

export class RelayError extends Error {
  readonly code: RelayCode;
  readonly exitCode: number;
  readonly fieldPath: string;

  constructor(code: RelayCode, message: string, fieldPath = "") {
    super(message);
    this.name = "RelayError";
    this.code = code;
    this.exitCode = exitCodes[code];
    this.fieldPath = fieldPath;
  }
}

export function formatIssuePath(path: ReadonlyArray<PropertyKey>): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") {
      out += `[${key}]`;
      continue;
    }
    const text = typeof key === "string" ? key : String(key);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
      out += out.length === 0 ? text : `.${text}`;
      continue;
    }
    out += `[${JSON.stringify(text)}]`;
  }
  return out;
}

export function fromZod(error: ZodError): RelayError {
  const issue: ZodIssue | undefined = error.issues[0];
  if (issue === undefined) {
    return new RelayError("validation", "validation failed", "");
  }
  const extra = error.issues.length - 1;
  const suffix = extra > 0 ? ` (+${extra} more)` : "";
  return new RelayError("validation", `${issue.message}${suffix}`, formatIssuePath(issue.path));
}

export function errorText(error: RelayError): string {
  if (error.fieldPath.length === 0) return `${error.message}\n`;
  return `${error.fieldPath}: ${error.message}\n`;
}

export function errorJson(error: RelayError): string {
  return `${
    JSON.stringify({
      schema: 1,
      error: {
        code: error.code,
        message: error.message,
        path: error.fieldPath,
      },
    })
  }\n`;
}
