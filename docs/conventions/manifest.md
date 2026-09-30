## Distill manifest (optional export)

`atry distill <run>` writes `$RUN_DIR/distill/manifest` — a flat `key: value`
file that a separate local tool (for example agent-relay-hub) can read when it
scans `.agent-relay/`. Distill is an **export, not a lifecycle stage**: it
appends no history event, never edits `meta.md`, and never closes the run.
Runs are closed with `atry close`. A run without a manifest is still a valid
run. Readers must not write into `.agent-relay/`.

### Run directory layout (contract)

Each run lives at:

```text
.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/
```

`{YMD}` is the creation date (`date +%Y%m%d`), `{RUN_ID}` is Unix seconds
(`date +%s`, 10–11 digits), and `{RUN_SLUG}` is lowercase `a-z` and hyphens
(length 3–48). The directory basename is the `run_id` value in the manifest.

### Manifest format (`schema: 1`)

```text
schema: 1
run_id: <run directory basename>
distilled_at: <UTC, YYYY-MM-DDTHH:MM:SSZ>
state: <value of the lifecycle: line from atry status <run>>
file.<relpath>: <sha256 hex>
```

One `file.` line per regular file under `$RUN_DIR`, with `relpath` relative to
`$RUN_DIR`, sorted with `LC_ALL=C`. Skip `distill/` and any path with a
segment that starts with `.` or ends in `.tmp` / `.lock`. Hash with
`shasum -a 256` or `sha256sum`. Write is atomic (temp under `distill/`, then
`mv`). Re-running overwrites; only `distilled_at` (and changed hashes /
`state`) typically differ. Works in every run state, including `abandoned` /
`done`.

Bump `schema` on any incompatible change to this format.
