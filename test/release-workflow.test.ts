import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("release workflow computes X.M.Z and publishes from main", () => {
  const yaml = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  expect(yaml).toContain("workflow_dispatch:");
  expect(yaml).toContain("major:");
  expect(yaml).toContain("type: boolean");
  expect(yaml).toContain("default: false");
  expect(yaml).not.toContain("push:");
  expect(yaml).toContain("github.ref != 'refs/heads/main'");
  expect(yaml).toContain("TZ: Asia/Ho_Chi_Minh");
  expect(yaml).toContain("contents: write");
  expect(yaml).toContain("id-token: write");
  expect(yaml).toContain("group: release");
  expect(yaml).toContain("cancel-in-progress: false");
  expect(yaml).toContain("fetch-depth: 0");
  expect(yaml).toContain("fetch-tags: true");
  expect(yaml).not.toContain("NODE_AUTH_TOKEN");
  expect(yaml).not.toContain("NPM_TOKEN");
  expect(yaml).toContain("npm install -g npm@11.15.0");
  expect(yaml).toContain("npm publish --provenance --access public --tag latest");
  expect(yaml).toContain("gh release create");
  expect(yaml).toContain("--generate-notes");
  expect(yaml).toContain("--check-requires");
  expect(yaml).toContain("npm version");
  expect(yaml).toContain("--no-git-tag-version");
  expect(yaml).not.toContain("git commit");

  const order = [
    "npm ci",
    "scripts/maint/next-version.ts",
    "--check-requires",
    "npm version",
    "npm run check",
    "npm run build",
    "npm test",
    "git push origin",
    "npm install -g npm@11.15.0",
    "npm publish --provenance --access public --tag latest",
    "gh release create",
    "atry version",
    "atry preflight --requires \">=0.10.7\"",
    "atry skills install --tool claude-code",
    "atry skills status --dir",
  ];
  let cursor = -1;
  for (const step of order) {
    const index = yaml.indexOf(step, cursor + 1);
    expect(index).toBeGreaterThan(cursor);
    cursor = index;
  }

  expect(yaml.indexOf("npm version")).toBeLessThan(yaml.indexOf("npm run build"));
  expect(yaml.indexOf("npm version")).toBeLessThan(yaml.indexOf("npm test"));
  expect(yaml).toContain("outputs:");
  expect(yaml).toContain("version: ${{ steps.version.outputs.version }}");
  expect(yaml).toContain("needs: publish");
  expect(yaml).toContain("npm install --prefix");
  expect(yaml).toContain("install.bundles.length !== 6");
  expect(yaml).toContain("status.ok !== true");
});
