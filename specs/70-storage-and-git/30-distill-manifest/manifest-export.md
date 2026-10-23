# Distill Manifest Export

The distill command (`src/core/distill.ts`) exports an integrity manifest of eligible files in the run directory.

## Command

```bash
atry distill <run> [--include-test-logs]
```

## Behavior

- Traverses regular files within the run directory, excluding `locks/`, temporary `*.tmp` files, the generated `90-distill/manifest.json`, and every `*.test.log` file.
- `--include-test-logs` adds the `*.test.log` files back. Use it for an explicit export of captured test output.
- Computes the SHA-256 hash and byte size of each file.
- Sorts records alphabetically by normalized relative path.
- Emits formatted JSON:

```json
{
  "schema": 1,
  "files": [
    {
      "path": "events.jsonl",
      "size": 1420,
      "sha256": "<64 hex characters>"
    },
    {
      "path": "run.json",
      "size": 890,
      "sha256": "<64 hex characters>"
    }
  ]
}
```

- Can be executed at any lifecycle stage without modifying run state.

## Verify

```bash
atry distill verify <run>
```

- Read `90-distill/manifest.json`. Do not write that file.
- Recompute the byte size and the SHA-256 of each listed file.
- Exit 0 when every file matches.
- Exit 1 when a file is missing or the size or hash differs. Name each path.
- Exit 3 when the manifest is missing.
- `--json` keeps `schema` 1. The object includes `ok`, `files`, `missing`, and `mismatched`.
