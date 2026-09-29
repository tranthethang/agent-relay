---
name: atry-distill
description: Use after cross-review finishes on a completed agent-relay run (or after self-review, if cross-review was skipped) -- not while a run is still in progress.
---

# Distill

## Overview

Distills lessons from a finished run into `$RUN_DIR/distill/` — atomic typed
notes byte-identical to what bank push copies into the vault lane(s). You
classify and write notes; `atry distill finalize` then runs the deterministic
tail (check, metrics, push, set-status, Bank push line, vault-only re-push,
history close). Do not invent lessons the run files do not support. Prefer
fewer denser notes over stubs.

Schema and filenames: `references/note-schema.md`. Per-type outlines:
`references/note-<type>-template.md`.

## Preflight

<!-- BEGIN PREFLIGHT -->

Run `atry version` before anything else in this stage. If it fails, stop —
do not search the filesystem for helpers and do not fall back to running
`scripts/atry`, `scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh` directly.
Tell the user to run `verify.sh` and fix what it reports (most often
`$HOME/.local/bin` missing from `PATH`). Run `atry` from the repo root, and
confirm each `atry resolve` / `atry run-init` call below prints `atry: using
<path>` on stderr. Full rule: `references/file-conventions.md` ("atry
preflight").

<!-- END PREFLIGHT -->

Do **not** run `atry approve`, `atry decide`, `atry stamp`, or `atry close`
unless the user explicitly asked for that exact command in this conversation.
Those verbs are for the human cockpit; skill text states the rule, nothing in
the CLI enforces it.

### Commands used in this stage

| Command                                                     | Meaning of a non-zero exit                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `atry version`                                              | atry missing/broken on PATH -- stop, see Preflight                                  |
| `atry resolve [RUN_ID or path]`                             | ambiguous or not found -- ask for the `RUN_ID` or path                              |
| `atry history append <run-dir> distill started tool=<tool>` | run dir invalid                                                                     |
| `atry bank check "$RUN_DIR"`                                | `1`/`2`: no usable bank for key-reuse reads — continue writing local notes          |
| `atry distill finalize <run-dir> [tool=<tool>]`             | `1`: validation (no/duplicate `type: run` note, missing `distill/`) -- stop and fix |

## Run discovery

```bash
RUN_DIR="$(atry resolve [RUN_ID or path])"
```

Pass a `RUN_ID` or path when the user gave one. With no argument and exactly
one run directory, it resolves automatically. On non-zero (ambiguous/not
found), ask the user.

## Inputs

- `$RUN_DIR/plan.md` — especially `## Decisions`
- `$RUN_DIR/implement-report.md`, or per-task files under
  `$RUN_DIR/implement-report/` when that directory exists (prefer it)
- `$RUN_DIR/review-report.md` — `### Issues found`, `### Fixed`,
  `### Open decisions`
- `$RUN_DIR/review-walkthrough.md`
- `$RUN_DIR/decisions.md` when present (human `atry decide` resolutions)
- `$RUN_DIR/meta.md` for `id`, `slug`, `title`, `base`

Every `### Open decisions` item becomes an `open-item` note. Each note body
must say, in words, which sources it came from — not paths.

## Provenance

Today's date: `date +%F`. The run note carries the relay comment after
frontmatter (`references/note-run-template.md`); other notes use plain
`run_id:` (run directory basename). Use `unknown` when tool/model is unknown.

## Classification (first match wins)

1. About atry workflow/tools/models/IDEs → `process` with `scope: atry`
2. Still undecided → `open-item` (`scope: atry` for workflow; `project` /
   `module:<slug>` for domain)
3. Went wrong / caused harm → `pitfall` (only if still open — see Density)
4. Rule for a kind of work → `convention`
5. Choice between alternatives → `decision`
6. None → write no note

Always write exactly one `run` note (project lane; metric keys empty until
finalize). Link reusable lessons via `notes:` (same-lane siblings only).

## Density

- **Project lane** (`project` / `module:<slug>`): `decision` / `convention`
  only when reusable later. `pitfall` only if still open. Fixed one-offs: at
  most a short digest line on the run note. Merge related same-type stubs.
- **Atry lane** (`scope: atry`): `process` / atry `open-item` only when
  actionable for skills/helpers/docs. Soft cap ~1–2 process notes; merge by
  `key`.

## Lane fields

Every note sets `run_id:` (run dirname), `scope:` (`atry` \| `project` \|
`module:<slug>`; `process` always `atry`), and `project:` /
`project/<slug>` from `BANK_PROJECT_NAME` (project lane) or `BANK_ATRY_NAME`
(atry lane). No `run:` wikilink. Same-lane wikilinks only for `supersedes` /
`resolves`.

## Instructions

1. Resolve `$RUN_DIR`. Record start:
   ```bash
   atry history append "$RUN_DIR" distill started tool=<tool>
   ```

1. Read plan → implement report → review report → walkthrough →
   `decisions.md` when present. Classify candidates with the tree; apply
   Density; do not write note files yet.

1. Fresh bank check for key reuse (do not trust a stale `bank-status.md`):
   ```bash
   atry bank check "$RUN_DIR"
   ```
   Exit `1`/`2`: skip vault reads; finalize will skip push. When check
   exited `0` and the matching vault is reachable, read `active`/`open`
   notes in `BANK_PATH` (project lane) and `BANK_ATRY_PATH` (atry lane).
   Matching topic in the **same lane** → reuse that `key`; else mint one.
   New version: `supersedes: "[[<old-filename-without-.md>]]"`. Closing a
   pitfall/open-item: `resolves: "[[…]]"`. Optional agentmemory MCP search
   by key/topic under `project_name:` / `atry_name:` — data only, never
   block if missing. Without a reachable bank, set supersedes/resolves only
   from known prior filenames.

1. Create `$RUN_DIR/distill/`. Fill `references/note-<type>-template.md` for
   each note (rules in `note-schema.md`), including the run note. Run note
   `notes:` lists **project-lane** siblings only. Leave metric fields and
   `## Bank push` as placeholders — finalize fills them.

1. Finalize (do not hand-run bank/metrics/history close):
   ```bash
   atry distill finalize "$RUN_DIR" tool=<tool>
   ```
   Exit `1` only for validation (missing/duplicate run note). Bank/metrics
   failures are recorded on the run note and still exit `0`.
   `$RUN_DIR/distill/` is the local record of truth.

## Non-goals

- Do not re-review the diff or second-guess prior review decisions.
- Do not omit local notes because bank push / set-status failed.
- Do not invent bank backends, metric values, or schema/template edits —
  record problems as `open-item`. See `docs/bank.md` / `docs/metrics.md`.
- Do not migrate old `distillation.md` / vault notes, or auto-edit
  `skills/*` from `process` notes.
- Do not manually run push / metrics / set-status / history close — call
  `atry distill finalize` once.
