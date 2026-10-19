# Architecture Layers

The `agent-relay` codebase separates command-line entrypoints, business validation, and system I/O into three primary layers.

## Layer Structure

```text
+-------------------------------------------------------+
|                     CLI Router                        |
|   (src/cli/: commands.ts, lifecycle.ts, claim.ts, ...) |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|                    Core Engine                        |
| (src/core/: lifecycle.ts, reduce.ts, claim.ts, ...)   |
+-------------------------------------------------------+
                           |
                           v
+-------------------------------------------------------+
|                Storage & Git Engine                   |
|   (src/core/git.ts, files.ts, lock.ts, event.ts)      |
+-------------------------------------------------------+
```

## Layer Responsibilities

### 1. CLI Router (`src/cli/`)

- Parses command-line arguments and flags via Commander.js.
- Handles global options (`--json`, `--run`).
- Resolves run identifiers into absolute directory paths.
- Directs structured JSON output or human-readable text to `stdout`.

### 2. Core Engine (`src/core/`)

- Implements lifecycle state transitions (`planned`, `approved`, `implementing`, `reviewing`, `closed`, `abandoned`).
- Enforces gates (e.g. review requirements, code modification boundaries, uncommitted tree match).
- Validates task schemas and DAG dependency constraints.
- Coordinates concurrency locks and prevents file overlap across parallel agent sessions.
- Generates scaffolds for runs, brainstorms, stages, and reviews.

### 3. Storage & Git Engine

- Reads and appends event records to `events.jsonl` under an atomic run lock.
- Computes git tree hashes using temporary Git indices, excluding `.agent-relay/`.
- Executes verification test commands specified in base repository policies.
- Writes SHA-256 distill manifests for auditable artifact export.
