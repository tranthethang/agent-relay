# Provenance Tracking

Provenance tracking (`src/core/review.ts` and `src/core/detect.ts`) binds declared tool and model identifiers to system-measured environment markers.

## Provenance Invariants

1. **Declared Identity**:
   - Every review requires `--tool <tool>`.
   - Cross-review strictly requires `--model <model>`.

2. **Locked Identity**:
   - Tool and model strings are recorded at `atry review new`.
   - When `atry review done` runs, it verifies that the JSON `tool` and `model` fields match the values locked at creation.
   - Refuses completion if values were modified in the JSON file.

3. **Environment Detection**:
   - Inspects environment variables for runtime tool signatures (e.g. `CODEX_THREAD_ID`).
   - If the detected environment contradicts the declared tool, issues a warning on stderr and logs `detected: "..."` in the event stream.
