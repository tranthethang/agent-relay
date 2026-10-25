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
- Emits JSON with a run header, an event anchor, and one labeled record for each file:

```json
{
  "schema": 1,
  "run": {
    "name": "20261024-1792849354-distill-run-metadata",
    "id": "1792849354",
    "slug": "distill-run-metadata",
    "title": "Distill manifest: run header, file labels, event anchor",
    "base": "<40 hex characters>",
    "head": "<40 hex characters>",
    "lifecycle": "implementing",
    "stage": "implement",
    "closedAt": null,
    "stages": [
      { "stage": "plan", "tool": "claude-code", "model": "claude-sonnet-5-5" },
      { "stage": "implement", "tool": "claude-code", "model": null }
    ]
  },
  "atEvent": { "count": 12, "sha256": "<64 hex characters>" },
  "files": [
    {
      "path": "events.jsonl",
      "size": 1420,
      "sha256": "<64 hex characters>",
      "kind": "events"
    },
    {
      "path": "20-implement/T1.md",
      "size": 640,
      "sha256": "<64 hex characters>",
      "kind": "implement-report",
      "stage": "implement",
      "task": "T1"
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
- Walk the run directory with the same filter as `atry distill`. Skip `90-distill/manifest.json`.
- Report each remaining path that the manifest does not name as `extra: <path>`.
- Skip a `*.test.log` that the manifest does not name. Verify a `*.test.log` that the manifest names.
- When the manifest has `atEvent`, read the raw event lines. The manifest is stale when three checks pass:
  - The first bytes of `events.jsonl` still match the size and hash of its manifest record.
  - More than `atEvent.count` lines exist.
  - Line `count` hashes to `atEvent.sha256`.
- On a stale manifest, report `events.jsonl` and `run.json` under `stale` instead of `mismatched`. Report `newEvents`, the number of lines after `count`.
- When an earlier line changed, line `count` does not hash to `atEvent.sha256`, or the log has fewer lines, keep `events.jsonl` under `mismatched`.
- A missing `events.jsonl` stays under `missing`, and `newEvents` is 0.
- A manifest without `atEvent` never reports `stale`.
- Exit 0 when every file matches and no extra file exists.
- Exit 1 when a file is missing, the size or hash differs, an extra file exists, or the manifest is stale. Name each path.
- Exit 3 when the manifest is missing.
- Text output prints `stale: yes` and `new events: <n>` after the `files` line, then `stale: <path>` for each stale path.
- `--json` keeps `schema` 1. The object includes `ok`, `files`, `missing`, `mismatched`, `extra`, `stale`, and `newEvents`.

## Fields

`schema` stays `1`. Each new field is additive and does not change an old field. `atry distill` always writes the new fields. A manifest without them still verifies.

### Run header

| Key         | Source                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`      | The run directory name.                                                                                                                                                                  |
| `id`        | `run.json` `id`.                                                                                                                                                                         |
| `slug`      | `run.json` `slug`.                                                                                                                                                                       |
| `title`     | `run.json` `title`.                                                                                                                                                                      |
| `base`      | `run.json` `base`.                                                                                                                                                                       |
| `head`      | `git rev-parse HEAD` in `run.worktree.path` when set, else the repo root. When that fails for a worktree run, `git rev-parse <worktree.branch>` in the repo root. `null` when both fail. |
| `lifecycle` | `run.json` `state.lifecycle`.                                                                                                                                                            |
| `stage`     | `run.json` `state.stage`.                                                                                                                                                                |
| `closedAt`  | The `ts` of the `closed` event, else of the `abandoned` event. `null` when neither exists.                                                                                               |
| `stages`    | One `{ stage, tool, model }` for each `started` event, in file order. `model` is `null` when absent.                                                                                     |

`stages` keeps every review round, so two self-review rounds give two `self-review` entries.

### Event anchor

`atEvent.count` is the number of lines in `events.jsonl`. `atEvent.sha256` is the SHA-256 of the last raw line. It is the value the next event stores as `prev`. An empty log hashes the empty string.

### File labels

Each file record has `kind`. It has `stage` and `task` when they apply. The first matching row wins. A path that matches no row gets `kind: "other"`.

| Path                           | `kind`             | `stage`        | `task` |
| ------------------------------ | ------------------ | -------------- | ------ |
| `events.jsonl`                 | `events`           | none           | none   |
| `run.json`                     | `run-cache`        | none           | none   |
| `10-plan/overview.md`          | `plan-overview`    | `plan`         | none   |
| `10-plan/tasks.input.json`     | `plan-tasks-input` | `plan`         | none   |
| `10-plan/index.json`           | `plan-index`       | `plan`         | none   |
| `10-plan/T<n>.md`              | `plan-task`        | `plan`         | `T<n>` |
| `20-implement/T<n>.md`         | `implement-report` | `implement`    | `T<n>` |
| `30-self-review/<NN>.md`       | `review-notes`     | `self-review`  | none   |
| `30-self-review/<NN>.json`     | `review-result`    | `self-review`  | none   |
| `30-self-review/<NN>.test.log` | `test-log`         | `self-review`  | none   |
| `40-cross-review/` same shapes | same kinds         | `cross-review` | none   |
| any other path                 | `other`            | none           | none   |
