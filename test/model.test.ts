import { expect, test } from "vitest";
import { modelLine, modelVendor } from "../src/core/model.js";

test("modelVendor maps supported model names to vendors", () => {
  expect(modelVendor("claude-opus-4")).toBe("anthropic");
  expect(modelVendor("gpt-5.4")).toBe("openai");
  expect(modelVendor("o3-mini")).toBe("openai");
  expect(modelVendor("codex-mini")).toBe("openai");
  expect(modelVendor("gemini-2.5")).toBe("google");
  expect(modelVendor("composer-1")).toBe("cursor");
  expect(modelVendor("other-model")).toBe("unknown");
});

test("modelLine removes trailing version numbers", () => {
  expect(modelLine("claude-opus-5-5")).toBe("claude-opus");
  expect(modelLine("gpt-5.4")).toBe("gpt");
  expect(modelLine("other-model")).toBe("other-model");
});
