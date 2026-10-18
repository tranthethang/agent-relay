import { type Tool } from "./vocab.js";

export type DetectedTool = Exclude<Tool, "unknown">;

export function detectTool(
  env: Readonly<Record<string, string | undefined>>,
): DetectedTool | undefined {
  // Confirmed in a live Codex task environment: CODEX_THREAD_ID is present.
  if (env.CODEX_THREAD_ID?.trim()) return "codex";
  return undefined;
}
