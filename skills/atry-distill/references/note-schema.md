# Note schema (knowledge bank)

Atomic, typed markdown notes with YAML frontmatter. One note = one
`type`. The bank is a **flat** folder of these files (no subfolders). This
schema is the contract for notes that `atry bank push` accepts and that
Obsidian Bases / Dataview can query.

Copy-and-fill outlines live next to this file: `note-<type>-template.md`.

## Types

| `type`       | Purpose                                                           | Statuses                                 |
| ------------ | ----------------------------------------------------------------- | ---------------------------------------- |
| `run`        | One note per completed run — summary + notes manifest             | _(none; immutable)_                      |
| `decision`   | A choice that was made and why                                    | `active` \| `superseded` \| `deprecated` |
| `convention` | A project/module rule worth following going forward               | `active` \| `superseded` \| `deprecated` |
| `pitfall`    | A recurring trap and how to avoid or fix it                       | `open` \| `resolved`                     |
| `open-item`  | An unresolved question or follow-up                               | `open` \| `resolved`                     |
| `process`    | An observation about how atry / the workflow itself should change | `active` \| `superseded` \| `deprecated` |

### Classification guide

- **run** — Always write exactly one per finished run. It is the index for
  that run's other notes (`notes:` list) and the place reserved metric
  fields live. Do not put reusable lessons here; link out to typed notes.
- **decision** — Prefer when the durable artifact is _what was chosen_ among
  alternatives (and the rationale), not a standing rule. If later work
  reverses it, mark `superseded` / `deprecated` rather than rewriting the
  old file.
- **convention** — Prefer when the lesson is a standing do/don't that future
  agents should apply without re-deriving the debate. Narrow with
  `scope: module:<name>` when it is not project-wide.
- **pitfall** — Prefer when the value is "watch for this failure mode"
  (symptom → cause → avoid/fix). Keep status `open` until the trap is
  patched or the mitigation is proven; then `resolved`.
- **open-item** — Prefer when something is still undecided or blocked. Close
  it with `resolved` and `--by` pointing at the note (or later run) that
  settled it; do not delete the open-item note.
- **process** — Prefer when the lesson is about _how the relay stages /
  helpers / skills should work_, not about the target project's domain.
  Feed these into future atry changes; keep domain rules as convention /
  decision / pitfall instead.

## Filename

```text
{YMD}-{RUN_ID}-{SLUG}.md
```

- `{YMD}` and `{RUN_ID}` match the run directory
  (`.agent-relay/{YMD}-{RUN_ID}-{RUN_SLUG}/`).
- The **run note** uses `{RUN_SLUG}` as `{SLUG}`.
- Every other note uses its own `{SLUG}`, unique within the run and
  **different** from `{RUN_SLUG}`.
- Slug regex (same as run slugs): `^[a-z]+(-[a-z]+)*$`, length 3–48
  inclusive.

The filename identifies one immutable **version**. Re-push with the same
filename overwrites that version in `BANK_PATH`.

## Two identities: filename vs `key`

| Identity | Where                             | Role                                             |
| -------- | --------------------------------- | ------------------------------------------------ |
| filename | on disk                           | one immutable version of a note                  |
| `key`    | frontmatter (all types but `run`) | stable topic id across versions; same slug rules |

Diffing over time: group by `key`, sort by `date`. `aliases: [<key>]`
makes `[[<key>]]` resolve in Obsidian; add older keys when a topic is
renamed.

## Frontmatter

Flat `key: value` only. Lists are a single line: `[a, b]`. The block
must start on **line 1** with `---` (Obsidian ignores properties
anywhere else; `atry bank push` refuses such files). Bash helpers parse
only that first `---` … `---` block. Fields that point at another note
(`run`, `supersedes`, `superseded_by`, `resolves`, `resolved_by`,
`derived_from`) are quoted wikilinks `"[[<filename-without-.md>]]"` so the
Obsidian graph links versions together.

| Field           | On types                        | Notes                                                                |
| --------------- | ------------------------------- | -------------------------------------------------------------------- |
| `type`          | all                             | one of the six types above                                           |
| `project`       | all                             | omit when `BANK_PROJECT_NAME` is unset; else match that slug         |
| `key`           | all except `run`                | topic id (slug rules)                                                |
| `status`        | all except `run`                | allowed values depend on `type` (see table)                          |
| `supersedes`    | decision / convention / process | wikilink to the prior version, e.g. `"[[{YMD}-{RUN_ID}-{SLUG}]]"`    |
| `superseded_by` | decision / convention / process | wikilink; set by `atry bank set-status … superseded --by <filename>` |
| `resolves`      | all except `run`                | wikilink to the `pitfall` / `open-item` this note closes             |
| `resolved_by`   | pitfall / open-item             | wikilink; set by `atry bank set-status … resolved --by <filename>`   |
| `derived_from`  | convention only                 | optional wikilink to the source decision                             |
| `run`           | all                             | wikilink to the run note, e.g. `[[{YMD}-{RUN_ID}-{RUN_SLUG}]]`       |
| `date`          | all                             | `YYYY-MM-DD`                                                         |
| `base`          | all                             | git ref recorded for the run                                         |
| `scope`         | all                             | `project` or `module:<name>`                                         |
| `tags`          | all                             | see Tags                                                             |
| `aliases`       | all except `run`                | `[<key>]` so `[[<key>]]` resolves; add older keys if renamed         |
| `notes`         | `run` only                      | `[<filename>, …]` manifest of sibling notes pushed with this run     |

Run notes also reserve metric field names (left empty in the template until
`atry metrics` fills them): `dur_implement_min`, `dur_self_review_min`,
`dur_cross_review_min`, `dur_distill_min`, `tool_*` / `model_*` for those
stages, `model_source`, `diff_base`, `files_changed`, `lines_added`, `lines_deleted`,
`tasks_planned`, `tasks_implemented`, `review_findings`, `review_rounds`,
`tokens`, `cost`. Exact names may grow; do not invent values here.

## Tags

- `atry/<type>` — always (`atry/run`, `atry/decision`, …)
- `project/<name>` — when `BANK_PROJECT_NAME` / frontmatter `project` is set
- `stack/<tech>` — optional, when a concrete stack matters

## Content rules

- Short code snippets are fine; do **not** include repo paths or
  `.agent-relay/` run-dir paths.
- Vault wikilinks `[[<filename-without-.md>]]` are allowed.
- Mermaid and tables only when they clarify; prefer short prose.
- No `#` H1 in the body — Obsidian already shows the filename as the title.
- Prefer `##` sections matching the per-type template.

## Lifecycle edits

`atry bank set-status` rewrites only `status` and, with `--by`,
`superseded_by` or `resolved_by` on the file already in `BANK_PATH`. The
run-dir copy stays a snapshot. Do not hand-edit those fields if you want
the helper's validation.
