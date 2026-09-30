# File conventions

Skills read and write files under `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/` in
the target repo, where `{YMD}` is the run creation date (`date +%Y%m%d`, never
renamed), `{RUN_ID}` is the Unix timestamp in seconds (`date +%s`, 10–11
digits), and `{RUN_SLUG}` is a short agent-authored slug (lowercase `a-z` and
hyphens, length 3–48 inclusive). All run artifacts live inside this per-run
directory using short, stable names (no `<id>` suffixes inside filenames).
Nothing in this repo enforces the names except the skill text and bash helpers.

This file is generated from parts under `docs/conventions/` by
`scripts/maint/sync-references.sh`. Edit those parts (not this file, and not
the copies under `skills/*/references/`). Maintainer docs that point here
(architecture, task-claim, skill authoring, …): [`INDEX.md`](INDEX.md).

| Purpose            | Path                                                                                                   | Written by                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Plan               | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/plan.md`                                                       | You, or `atry-plan`.                                                   |
| Task list          | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-plan.md` (or `implement-plan/` in parallel mode)     | `atry-implement`                                                       |
| Implement notes    | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/implement-report.md` (or `implement-report/` in parallel mode) | `atry-implement`                                                       |
| Review report      | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-report.md`                                              | `atry-self-review` creates or overwrites. `atry-cross-review` appends. |
| Review walkthrough | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/review-walkthrough.md`                                         | Same as the review report.                                             |
| Metadata           | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/meta.md`                                                       | `atry run-init` creates; stages update `stage:` and `status:`.         |
| History (optional) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/history.log`                                                   | `atry history` / stages append events.                                 |
| Decisions          | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/decisions.md`                                                  | `atry decide` (human); append-only resolutions.                        |
| Distill (optional) | `.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/distill/manifest`                                              | `atry distill` / `atry-distill` — export only; not a lifecycle stage.  |

`<RUN_ID>` is the Unix timestamp in seconds (`date +%s`). `<RUN_SLUG>` is 3–48
characters matching `^[a-z]+(-[a-z]+)*$`.

Empty outlines for each artifact live in that skill's
`references/*-template.md` (installed with the bundle). Runtime files live
inside their respective run directory.

## atry preflight

Every stage skill (`atry-plan`, `atry-implement`, `atry-self-review`,
`atry-cross-review`, `atry-distill`) starts the same way, before touching any
run artifact:

1. Run `atry version` once, from the repo root (`git rev-parse
   --show-toplevel`, or the project root for a non-git project). If it fails
   (not found, or exits non-zero), **stop**. Tell the user to run
   `bin/verify.sh` (or the installed `verify.sh`) and fix what it reports —
   most often `$HOME/.local/bin` missing from `PATH`, or a stale/broken
   install. Do not try anything else first.
2. Never search the filesystem for helpers, and never fall back to running
   `scripts/atry`, `scripts/runtime/*.sh`, or `~/.agent-relay/lib/*.sh`
   directly. `atry` on `PATH` is the only supported entrypoint for an
   installed skill. Do not substitute a guessed path when `atry` is missing —
   that is exactly the failure `verify.sh`'s PATH check exists to catch.
3. Continue only after `atry version` succeeds. Every subsequent `atry
   resolve` / `atry run-init` call in the stage prints `atry: using
   <path-to-.agent-relay>` on stderr once it finds a run root — that line is
   the confirmation the stage is reading and writing the right
   `.agent-relay/`, not a fallback the CLI invented. If no `.agent-relay/` or
   git repository is found walking up from the current directory, `atry`
   errors with a hint (run from the repo root, `git init`, or `mkdir
   .agent-relay`) instead of guessing a location — it does not create one
   under the current directory automatically.

This section is the single source for the preflight rule; each skill's
`SKILL.md` links here rather than repeating the rationale.

## Run resolution

Each run directory under `.agent-relay/` is self-contained. Skills and helpers
resolve the active run directory in this strict order (they must **never**
guess via file mtime):

1. The user passed a `RUN_ID`, `RUN_SLUG`, full dirname, or any path under a run directory.
2. Else if exactly one run directory exists matching `[0-9]{8}-*`, use that directory.
3. Else ask the user. Do not guess.

Directory matching rules:

- Run directory format: `^([0-9]{8})-([0-9]{10,11})-([a-z]+(-[a-z]+)*)$`.
- Lookup by ID: A unique directory under `.agent-relay/` matching `*-${RUN_ID}-*` or by slug.
- Lookup by full path or dirname: Matches directly.

## `meta.md` (Source of Truth for Run Status)

Every run directory contains `meta.md` created at plan time:

```markdown
id: <RUN_ID>
slug: <RUN_SLUG>
created: <YYYY-MM-DD>
title: <short>
stage: plan|implement|self-review|cross-review|done
status: active|done|abandoned
base: <git-ref>
```

Field definitions:

- `id`: The Unix timestamp run identifier (`date +%s`).
- `slug`: Short slug (lowercase letters and hyphens, 3–48 characters).
- `created`: Date the run was initialized (`YYYY-MM-DD`).
- `title`: Short summary of the run's goal.
- `stage`: Current workflow stage (`plan`, `implement`, `self-review`, `cross-review`, or `done`).
- `status`: Lifecycle status (`active`, `done`, or `abandoned`).
- `base`: Git commit ref from which the work branches or diffs.

`atry history append` updates `stage:` for recognized stages on lifecycle
actions (`created` / `started` / `completed` / `abandoned`) only — not on
human record actions (`approved` / `attested` / `resolved`). Appending
`done completed` also sets `status: done` (`atry close`). Appending an
`abandoned` action sets `status: abandoned` (`atry close --abandon`).
Distill does not change `meta.md`; close the run with `atry close`.

## `history.log` (Append-Only Event Log)

An optional, append-only log file `history.log` records stage transitions and
major actions. Each line is formatted as:

`<TIMESTAMP> stage=<stage> action=<action> [key=value ...]`

Example:

```text
2026-09-16T03:05:00Z stage=plan action=created tool=cursor
2026-09-16T03:15:22Z stage=implement action=started tool=cursor
2026-09-16T03:45:10Z stage=implement action=completed tool=cursor
```

Timestamp must be ISO8601 UTC. Use `atry history` to safely append to
this file. On `implement started` and on `implement` / `self-review` /
`cross-review` `completed`, `atry history append` records `head=` (current
`HEAD`) automatically unless `head=` was passed explicitly — raw data for
downstream readers. On those `completed` events it also records
`size_base=<sha> size=<files>/<added>/<deleted>` (working tree vs the diff
base at that moment).

Human cockpit writers (`atry approve` / `stamp` / `decide` / `close`) also
append through this path with `by=human`:

| Command                        | History line                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `atry approve <run> plan`      | `stage=plan action=approved by=human [note=…]`                         |
| `atry stamp <run> <stage> …`   | `stage=<stage> action=attested by=human tool=… model=…`                |
| `atry decide <run> <id> "…"`   | `stage=decision action=resolved by=human id=<slug>` (+ `decisions.md`) |
| `atry close <run>`             | `stage=done action=completed by=human`                                 |
| `atry close <run> --abandon …` | `stage=done action=abandoned by=human reason=…`                        |

On `implement started`, if the run has no `stage=plan action=approved` event,
`atry history append` prints one stderr warning and still appends (exit 0).

## `decisions.md` (human resolutions)

Append-only file written by `atry decide`. Each line:

```text
- <YYYY-MM-DD> <id>: <resolution> (by=human)
```

`<id>` follows the run-slug rules (`^[a-z]+(-[a-z]+)*$`, length 3–48). Free
text lives here; the history event only carries `id=<slug>`.

## Plan header

`plan.md` starts with the git ref you will diff from, and the id:

```markdown
base: <git-ref>
id: <RUN_ID>

# <title>
```

If those lines are missing, `atry-implement` adds them before coding. `base`
should be a real ref in that repo (`HEAD` before the work, or the branch tip).
Do not invent one. The plan skill's `references/plan-template.md` also outlines
`## Non-goals`, the optional `## Decisions` and `## Flow` sections, and
numbered tasks that may list `(deps: T1 T2)`. Helpers parse only `## Tasks`.
