# Preflight Gate & Version Check

The preflight subsystem (`src/core/preflight.ts`) validates that the locally executing `atry` CLI binary satisfies minimum version constraints required by skill bundles.

## Interface

```bash
atry preflight --requires ">=X.M.Z"
```

## Behavior

- Reads current CLI version via `packageVersion()`.
- Parses the comparison range (e.g. `>=0.1.0`).
- If current version satisfies the range:
  - Exits with status `0`.
- If current version is older than required:
  - Prints installation instructions: `npm i -g @tranthethang/agent-relay@latest`.
  - Exits with status `1` (`usage`).
