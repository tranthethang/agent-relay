export type Result = {
  schema: 1;
};

export function renderResult<T extends Result>(
  result: T,
  json: boolean,
  toText: (result: T) => string,
): string {
  if (json) return `${JSON.stringify(result)}\n`;
  return toText(result);
}

export function writeResult<T extends Result>(
  result: T,
  json: boolean,
  toText: (result: T) => string,
): void {
  process.stdout.write(renderResult(result, json, toText));
}

export function withWarnings<T extends Result>(
  result: T,
  warnings: string[],
): T & { warnings?: string[] } {
  if (warnings.length === 0) return result;
  return { ...result, warnings };
}
