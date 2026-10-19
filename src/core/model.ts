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
  return stripTrailingSeparators(stripTrailingVersion(model.trim().toLowerCase()));
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function stripTrailingVersion(value: string): string {
  let index = value.length;
  const consumeDigits = (): boolean => {
    const end = index;
    while (index > 0 && isDigit(value[index - 1])) index -= 1;
    return index < end;
  };
  if (!consumeDigits()) return value;
  while (index > 0 && (value[index - 1] === "." || value[index - 1] === "-")) {
    const separator = index;
    index -= 1;
    if (!consumeDigits()) {
      index = separator;
      break;
    }
  }
  const prefix = value[index - 1];
  const before = value[index - 2];
  if (
    (prefix === "-" || prefix === "_" || prefix === ".")
    && (before === undefined || !isDigit(before))
  ) {
    index -= 1;
  }
  return value.slice(0, index);
}

function stripTrailingSeparators(value: string): string {
  let index = value.length;
  while (index > 0) {
    const char = value[index - 1];
    if (char !== "-" && char !== "_" && char !== ".") break;
    index -= 1;
  }
  return value.slice(0, index);
}
