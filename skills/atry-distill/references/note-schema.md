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
  that run's **project-lane** sibling notes (`notes:` list) and the place
  reserved metric fields live. Do not put reusable lessons here; link out
  to typed notes. Process / atry-lane siblings are **not** listed in
  `notes:` (they carry `run_id:` only).
- **decision** — Prefer when the durable artifact is _what was chosen_ among
  alternatives (and the rationale), not a standing rule. Write only when
  reusable on a later run. If later work reverses it, mark `superseded` /
  `deprecated` rather than rewriting the old file.
- **convention** — Prefer when the lesson is a standing do/don't that future
  agents should apply without re-deriving the debate. Write only when
  reusable on a later run. Narrow with `scope: module:<name>` when it is
  not project-wide.
- **pitfall** — Prefer when the value is "watch for this failure mode"
  (symptom → cause → avoid/fix) **and** the trap is still open after the
  run (mitigation not done). Do not write a typed note for a one-off bug
  already fixed in-run (at most a short line under the run note digest).
  Keep status `open` until the trap is patched or the mitigation is
  proven; then `resolved`.
- **open-item** — Prefer when something is still undecided or blocked.
  Open items about the atry workflow use `scope: atry`; domain open-items
  stay `project` / `module:`. Close with `resolved` and `--by` pointing at
  the note (or later run) that settled it; do not delete the open-item
  note.
- **process** — Prefer when the lesson is about _how the relay stages /
  helpers / skills should work_, not about the target project's domain.
  Always `scope: atry`. Write only when there is an actionable suggestion
  for skills/helpers/docs; soft cap ~1–2 process notes per run; merge by
  `key` when themes overlap. Feed these into future atry changes; keep
  domain rules as convention / decision / pitfall instead.

### Density (summary)

- **Project lane** (`scope: project` or `module:<slug>`): write `decision` /
  `convention` only when reusable later; write `pitfall` only if still
  open after the run. Soft preference: merge related same-type candidates;
  avoid stub proliferation.
- **Atry lane** (`scope: atry`): write `process` (and atry-scoped
  `open-item`) only for actionable workflow suggestions; soft cap ~1–2
  process notes per run.

Full distill procedure (when to skip a candidate, run-note digest) lives in
`skills/atry-distill/SKILL.md`.

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
filename overwrites that version in the destination lane path
(`BANK_PATH` or `BANK_ATRY_PATH`).

## Two identities: filename vs `key`

| Identity | Where                             | Role                                             |
| -------- | --------------------------------- | ------------------------------------------------ |
| filename | on disk                           | one immutable version of a note                  |
| `key`    | frontmatter (all types but `run`) | stable topic id across versions; same slug rules |

Diffing over time: group by `key`, sort by `date`. `aliases: [<key>]`
makes `[[<key>]]` resolve in Obsidian; add older keys when a topic is
renamed.

## Lanes and routing

`atry bank push` partitions notes by `scope`:

| `scope` value   | Vault destination                       | agentmemory `project` | Typical types                                 |
| --------------- | --------------------------------------- | --------------------- | --------------------------------------------- |
| `atry`          | `BANK_ATRY_PATH` (if set and reachable) | `BANK_ATRY_NAME`      | `process`; atry-workflow `open-item`          |
| `project`       | `BANK_PATH` (if set and reachable)      | `BANK_PROJECT_NAME`   | `run`, `decision`, `convention`, domain notes |
| `module:<slug>` | `BANK_PATH` (same as project)           | `BANK_PROJECT_NAME`   | domain notes narrowed to a module             |

- `process` **must** use `scope: atry`. Push refuses otherwise.
- If `BANK_ATRY_PATH` / `BANK_ATRY_NAME` are unset, atry-lane notes stay in
  local `distill/` only — they are **not** copied into `BANK_PATH`.
- When both vault paths resolve to the same absolute directory, push still
  writes each file once and sets each note's `project:` from its lane name.

## Frontmatter

Flat `key: value` only. Lists are a single line: `[a, b]`. The block
must start on **line 1** with `---` (Obsidian ignores properties
anywhere else; `atry bank push` refuses such files). Bash helpers parse
only that first `---` … `---` block.

Fields that point at another note **in the same lane**
(`supersedes`, `superseded_by`, `resolves`, `resolved_by`,
`derived_from`) are quoted wikilinks `"[[<filename-without-.md>]]"` so the
Obsidian graph links versions together. Do **not** use cross-lane
wikilinks. Provenance to the originating run is a plain `run_id:` string
(not a wikilink). Push refuses a leftover `run:` wikilink field.

| Field           | On types                        | Notes                                                                                       |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `type`          | all                             | one of the six types above                                                                  |
| `project`       | all                             | project lane: `BANK_PROJECT_NAME` (omit when unset); atry lane: `BANK_ATRY_NAME` when set   |
| `key`           | all except `run`                | topic id (slug rules)                                                                       |
| `status`        | all except `run`                | allowed values depend on `type` (see table)                                                 |
| `supersedes`    | decision / convention / process | same-lane wikilink to the prior version                                                     |
| `superseded_by` | decision / convention / process | same-lane wikilink; set by `atry bank set-status … superseded --by`                         |
| `resolves`      | all except `run`                | same-lane wikilink to the `pitfall` / `open-item` this note closes                          |
| `resolved_by`   | pitfall / open-item             | same-lane wikilink; set by `atry bank set-status … resolved --by`                           |
| `derived_from`  | convention only                 | optional same-lane wikilink to the source decision                                          |
| `run_id`        | all                             | run directory basename without `.md` (e.g. `20260928-1790560317-distill-density-dual-bank`) |
| `date`          | all                             | `YYYY-MM-DD`                                                                                |
| `base`          | all                             | git ref recorded for the run                                                                |
| `scope`         | all                             | `atry` \| `project` \| `module:<slug>`                                                      |
| `tags`          | all                             | see Tags                                                                                    |
| `aliases`       | all except `run`                | `[<key>]` so `[[<key>]]` resolves; add older keys if renamed                                |
| `notes`         | `run` only                      | `[<filename>, …]` **same-lane** (project) sibling filenames only                            |

Run notes also reserve metric field names (left empty in the template until
`atry metrics` fills them): `dur_implement_min`, `dur_self_review_min`,
`dur_cross_review_min`, `dur_distill_min`, `tool_*` / `model_*` for those
stages, `model_source`, `diff_base`, `diff_end`, `files_changed`, `lines_added`, `lines_deleted`,
`tasks_planned`, `tasks_implemented`, `review_findings`, `review_rounds`,
`tokens`, `cost`. Exact names may grow; do not invent values here.

## Tags

- `atry/<type>` — always (`atry/run`, `atry/decision`, …)
- `project/<name>` — when the lane's name / frontmatter `project` is set
  (`BANK_PROJECT_NAME` for project lane; `BANK_ATRY_NAME` for atry lane)
- `stack/<tech>` — optional, when a concrete stack matters

## Content rules

- Short code snippets are fine; do **not** include repo paths or
  `.agent-relay/` run-dir paths.
- Vault wikilinks `[[<filename-without-.md>]]` are allowed **within the
  same lane** only.
- Mermaid and tables only when they clarify; prefer short prose.
- No `#` H1 in the body — Obsidian already shows the filename as the title.
- Prefer `##` sections matching the per-type template.

## Lifecycle edits

`atry bank set-status` rewrites only `status` and, with `--by`,
`superseded_by` or `resolved_by` on the file already in `BANK_PATH` or
`BANK_ATRY_PATH` (lookup: project path first, then atry path). `--by`
must resolve on the **same** path as the edited note. The run-dir copy
stays a snapshot. Do not hand-edit those fields if you want the helper's
validation.
