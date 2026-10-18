const vendorPatterns: ReadonlyArray<[RegExp, string]> = [
  [/^claude(?:$|[-_.])/, "anthropic"],
  [/^(?:gpt|codex)(?:$|[-_.])/, "openai"],
  [/^o\d(?:$|[-_.])/, "openai"],
  [/^gemini(?:$|[-_.])/, "google"],
  [/^composer(?:$|[-_.])/, "cursor"],
];

export function modelVendor(model: string): string {
  const normalized = model.trim().toLowerCase();
  return vendorPatterns.find(([pattern]) => pattern.test(normalized))?.[1] ?? "unknown";
}

export function modelLine(model: string): string {
  return model.trim().toLowerCase().replace(/[-_.]?\d+(?:[.-]\d+)*$/, "").replace(/[-_.]+$/, "");
}
