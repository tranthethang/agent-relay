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
