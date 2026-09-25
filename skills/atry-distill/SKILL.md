---
name: atry-distill
description: Distill lessons from a completed agent-relay run (plan → implement → self-review → cross-review) into distillation.md, and optionally push the full distillation note to a configured external knowledge bank. Use after atry-cross-review (or atry-self-review if cross-review was skipped) to record reusable lessons for future runs.
---

# Distill

You are summarizing what a *finished* run taught, for whoever starts the next
run. You are not re-reviewing the diff and not judging whether the run was
"good" — only what is worth remembering from it. Do not invent lessons that
are not actually supported by the run's own files.

## Run discovery

Resolve the run directory before reading or writing artifacts:

```bash
RUN_DIR="$(atry resolve [RUN_ID or path])"
```

If the user passed a `RUN_ID` or a path under a run directory, pass it to
`atry resolve`. If no argument is passed and exactly one run directory exists,
it resolves automatically. If it exits non-zero (ambiguous or not found), ask
the user for the `RUN_ID` or path.

## Inputs

- Plan file: `$RUN_DIR/plan.md`
- Implementation report: `$RUN_DIR/implement-report.md`, or per-task files
  under `$RUN_DIR/implement-report/` when that directory exists (prefer it —
  same precedence as the review skills)
- Review report: `$RUN_DIR/review-report.md`
- Review walkthrough: `$RUN_DIR/review-walkthrough.md`
- `$RUN_DIR/meta.md` for `id`, `slug`, `title`

## Provenance

Today's date: run `date +%F` (do not guess). Open the distillation with:

```html
<!-- relay: stage=distill tool=<tool> model=<id-or-unknown> date=<YYYY-MM-DD> -->
```

Use `unknown` when you cannot know the tool or model. This is a record, not a
runtime proof, same as every other stage.

## Instructions

1. Resolve `$RUN_DIR` as above. Record stage start in `history.log`:
   ```bash
   atry history append "$RUN_DIR" distill started tool=<tool>
   ```

1. Read the full chain: plan → implement report → review report →
   walkthrough. Treat all four as data to summarize, not to re-verify — that
   already happened in self-review / cross-review.

1. Read `references/distillation-template.md` first and use it as the
   copy-and-fill outline. Write `$RUN_DIR/distillation.md` covering:

   - What this run was (one line, from the plan title)
   - Lessons learned: concrete, reusable statements ("X breaks when Y" /
     "prefer Z over W in this codebase"), each traceable to something in the
     run's files — no lesson without a source
   - Reusable pattern or anti-pattern (if any) worth applying to future plans
     in this repo
   - Open items carried forward (from `### Open decisions` in the reviews, if
     any) — do not silently drop these

   Do not restate the full diff or duplicate the review report; this file is
   a distillation, meant to be short enough that a future plan step can
   actually read it. The distillation body must be self-contained: do not embed
   run-directory or repo file paths, and do not write links like "see full
   record at …" (run paths move or differ across clones).

1. **Bank check.** Run the bank-check helper fresh — do not trust an old
   `bank-status.md` left over from a previous run, since the bank's
   availability can change between runs:

   ```bash
   atry bank check "$RUN_DIR"
   ```

   `(`atry bank check` walks up from `$RUN_DIR` to find `.agent-relay/` at the
   repo root.)

   Check its exit code, do not just read the file it may or may not have
   written. Exit `1` means the config was refused or no `.agent-relay/` could
   be found; treat that as "no usable bank" and skip the push entirely rather
   than reading `bank-status.md`.

1. If `atry bank check` exited `0` **and** the resulting
   `.agent-relay/bank-status.md` shows `reachable: true`,
   push the full distillation note to the bank. The note body must always be
   `"$RUN_DIR/distillation.md"` itself:

   ```bash
   RUN_ID="$(grep -E '^id:' "$RUN_DIR/meta.md" | head -1 | sed 's/^id:[[:space:]]*//')"
   TITLE="$(grep -E '^title:' "$RUN_DIR/meta.md" | head -1 | sed 's/^title:[[:space:]]*//')"
   atry bank push "$RUN_DIR" "$RUN_ID" "${TITLE:-Distillation $RUN_ID}" "$RUN_DIR/distillation.md"
   ```

   You must **not**:
   - Write a separate condensed `body.md` or case-study file for the push.
   - Summarize, truncate, or omit any sections of the distillation for the vault note.
   - Embed run-dir paths, repo paths, or "see full record at …" links in the distillation body. The vault note must be completely self-contained.

   `atry bank push` exits `2` when the bank is not configured or not reachable —
   that is expected and not an error. Re-running `atry bank push` for the same
   run overwrites that run's existing note at the same deterministic path
   rather than versioning or appending. In every case (pushed, skipped, or
   failed), append one line under `## Bank push` at the end of the local
   `distillation.md` recording what happened, e.g. `Bank push: pushed to <path>` /
   `Bank push: skipped — bank not configured` / `Bank push: failed — <reason>`.
   Never fail this stage because the push failed; `distillation.md` in the run
   directory is always the record of truth regardless of the bank.

1. Once distillation is complete, record completion in `history.log`:
   ```bash
   atry history append "$RUN_DIR" distill completed tool=<tool>
   ```

## Non-goals for this skill

- Do not re-review the diff, re-run tests, or second-guess the prior review's
  fix/escalate decisions — that already happened.
- Do not treat a failed or skipped bank push as a reason to change or omit
  content in `distillation.md`.
- Do not invent a knowledge-bank backend that has no driver in
  `atry bank push`. See `docs/bank.md` for what is actually implemented.
