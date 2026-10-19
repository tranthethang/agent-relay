# Distill Manifest Export

The distill command (`src/core/distill.ts`) exports an integrity manifest of eligible files in the run directory.

## Command

```bash
atry distill <run>
```

## Behavior

- Traverses regular files within the run directory, excluding `locks/`, temporary `*.tmp` files, and the generated `90-distill/manifest.json`.
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
