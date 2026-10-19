# Dual Output Protocol

The CLI supports dual output rendering via `writeResult()` (`src/cli/output.ts`):

- **Human-Readable Text**: Default for terminal interactive use. Uses succinct key-value pairs and minimal formatting.
- **Machine-Readable JSON**: Activated when `--json` is supplied. Outputs single structured JSON objects or arrays to `stdout`.

## Contract

1. When `--json` is active:
   - Output must be valid JSON parseable by `JSON.parse()`.
   - All diagnostic warnings and non-fatal alerts must print to `stderr`, leaving `stdout` pure JSON.
   - The root object includes a top-level `schema: 1` version attribute.

2. When `--json` is inactive:
   - Text formatters output clean, unadorned strings without ANSI escape codes, ensuring compatibility with AI agent sub-processes.
