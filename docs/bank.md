# Knowledge bank (optional)

An **opt-in** connection from one target repo to an external flat folder of
typed markdown notes. After a run, `atry-distill` writes notes under
`$RUN_DIR/distill/` and `atry bank push` copies that directory flat into
`BANK_PATH`. This is project-level configuration — one bank per repo, declared
once at `.agent-relay/bank.conf` — not per-run.

This is not a runtime and does not run in the background. Nothing here
polls, syncs, or watches the bank. `atry bank check`, `atry bank push`, and
`atry bank set-status` are one-shot helpers an agent runs when a skill tells
it to.

Note shape (types, statuses, filename rule, frontmatter, tags, content
rules): [`skills/atry-distill/references/note-schema.md`](../skills/atry-distill/references/note-schema.md)
and the `note-*-template.md` files beside it.

## What this is not

- Not RAG, not embeddings, not search. It writes plain markdown notes; what
  you do with them in your bank (Bases, Dataview, embed, retrieve) is up to
  your own tooling.
- Not enrichment from the bank into plan / implement / review. `atry-plan`
  may skim local `$RUN_DIR/distill/` notes from prior runs; nothing reads
  `BANK_PATH` back into a prompt.
- Not a guarantee of push success beyond a basic writability check.
  `reachable: true` means "the declared path exists and is writable" (for
  `obsidian-vault`), not "your notes app indexed the file."
- Not a directory creator. Developers create `BANK_PATH` themselves; atry
  never creates it or any subdirectory under it.

## `bank.conf`

Lives at `.agent-relay/bank.conf` in the target repo. Plain `BANK_KEY=value`
lines only — `atry bank check` parses it line-by-line and never
sources or evals it. A line with `$()`, backticks, `;`, `&&`, `||`, a pipe,
or a redirect is refused outright, and parsing stops at the first offending
line.

Blank lines and whole-line `#` comments (with or without leading whitespace)
are ignored. Keys must start at column 0: an indented `BANK_KEY=value` line
is refused rather than silently skipped. Trailing inline comments are **not**
supported — `BANK_TYPE=obsidian-vault # note` sets the type to the whole
string including the comment, which then reports as an unknown `BANK_TYPE`.

```bash
# .agent-relay/bank.conf
BANK_TYPE=obsidian-vault
BANK_PATH=/absolute/path/to/your/vault/folder
# optional; slug regex, length 3–48 (no trailing comments on value lines)
BANK_PROJECT_NAME=agent-relay
```

| Key                 | Required  | Notes                                                                                                 |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `BANK_TYPE`         | yes       | Backend id (see table below)                                                                          |
| `BANK_PATH`         | for vault | Existing writable directory; trailing `/` is stripped by `atry bank check`                            |
| `BANK_ENDPOINT`     | reserved  | For `lightrag-http` later                                                                             |
| `BANK_PROJECT_NAME` | no        | Project slug written into note `project:` / `project/<name>` tags; invalid value = malformed (exit 1) |

Duplicate `BANK_PROJECT_NAME` values across repos are intentional and never
warned about.

| `BANK_TYPE`      | Status                  | What it needs                                                                                    |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `obsidian-vault` | Implemented             | `BANK_PATH` — an existing, writable local directory (vault root, or any folder Obsidian watches) |
| `lightrag-http`  | Reserved, no driver yet | Would need `BANK_ENDPOINT` and real network egress from wherever the agent runs                  |

Declaring `lightrag-http` today is harmless: `atry bank check` records it as
`reachable: false` with a `detail` explaining there is no driver, and
`atry bank push` / `set-status` refuse (exit `2`). The old reserved
`agentmemory-cli` type is gone; agentmemory will be a separate config key in a
later run.

## `atry bank check`

```bash
atry bank check [<start-dir>]
```

Walks up from `<start-dir>` (default: cwd) the same way `atry resolve`
does, looking for an existing `.agent-relay/`, or the nearest `.git` root if
none exists yet. Writes `.agent-relay/bank-status.md`:

```text
configured: true
bank_type: obsidian-vault
bank_path: /absolute/path/to/your/vault/folder
bank_endpoint: 
project_name: agent-relay
project_source: config
reachable: true
checked_at: 2026-09-17T08:00:00Z
detail: vault directory exists and is writable
check_warnings: 
push_warnings:
```

`project_source` is `config` when `BANK_PROJECT_NAME` is set, else `none`.
When reachable and a project name is set, notes already in `BANK_PATH` whose
frontmatter `project:` differs produce an advisory warning on stderr and a
`check_warnings:` token (`foreign-project:<filename>`); exit remains `0`.

Warnings are split by the command that produced them: `atry bank check`
rewrites only `check_warnings:` and keeps `push_warnings:` from the last
push; `atry bank push` rewrites only `push_warnings:` and keeps
`check_warnings:`. Tokens are space-separated; an empty value means that
command's last run had none.

No `bank.conf` is a normal, supported state (`configured: false`), not an
error — most target repos will never set one up. A malformed `bank.conf`
(anything not `BANK_KEY=value`, unsafe characters, or an invalid
`BANK_PROJECT_NAME`) is a hard refusal: exit `1`, and `bank-status.md` is
overwritten with `reachable: false` so a stale `reachable: true` cannot
survive for push to trust.

Run it fresh before every push. Reachability can change between runs for
reasons check cannot detect on its own.

_Known limitation_: `[[ -w "$BANK_PATH" ]]` tests writability via file
permission bits. When running as `root`, `[[ -w ]]` may report true even on a
read-only mount. Treat reachability as advisory in such environments.

## `atry bank push`

```bash
atry bank push <start-dir> <notes-dir>
```

Copies every `*.md` in `<notes-dir>` **flat** into `BANK_PATH` (no
`agent-relay/` subfolder, no injected `#` title). Re-push overwrites the same
filenames.

Refuses (exit `2`) unless the most recent `bank-status.md` says
`configured: true` and `reachable: true`. Validates **all** notes before
writing any: filename must match `{YMD}-{RUN_ID}-{SLUG}.md`, and frontmatter
must include an allowed `type` (`run`, `decision`, `convention`, `pitfall`,
`open-item`, `process`). Any failure exits `1` and writes nothing from this
push.

Advisory (exit `0`): orphan notes in `BANK_PATH` that share the pushed run's
`{YMD}-{RUN_ID}-` prefix but were not in this push, and foreign `project`
values — stderr plus `push_warnings:` in `bank-status.md` (`check_warnings:`
is left as the last check wrote it).

A failed or skipped push must never block distill from finishing: the run-dir
note copies remain the durable local record.

## `atry bank set-status`

```bash
atry bank set-status <start-dir> <filename> <status> [--by <filename>]
```

Edits **only** lifecycle fields on a note already in `BANK_PATH` (the run-dir
copy stays a snapshot):

- `status` — must be allowed for the note's `type` (`run` notes are immutable
  and refuse any status change).
- With `--by <filename>` and status `superseded` → also sets `superseded_by`.
- With `--by <filename>` and status `resolved` → also sets `resolved_by`.

`<filename>` and `--by` are basenames matching the note filename rule, not
paths. The `--by` filename is stored as a quoted wikilink
(`superseded_by: "[[<filename-without-.md>]]"`) so Obsidian links the
versions. The body after the closing `---` is left byte-identical, and the
file is rewritten in place (permissions kept).

`atry bank push` refuses any note whose frontmatter does not open with `---`
on line 1 — Obsidian ignores properties anywhere else.

## Obsidian query examples

Flat notes with YAML frontmatter work with Bases and Dataview. Examples
(adjust property names if your plugin expects different casing):

**Bases** — open decisions for this project:

```yaml
filters:
  and:
    - type == "decision"
    - status == "active"
    - project == "agent-relay"
```

**Dataview** — open pitfalls:

````markdown
```dataview
TABLE key, status, date
FROM "your-bank-folder"
WHERE type = "pitfall" AND status = "open"
SORT date DESC
```
````

**Dataview** — versions of one topic by `key`:

````markdown
```dataview
TABLE file.name AS version, status, date, superseded_by
FROM "your-bank-folder"
WHERE key = "flat-bank-layout"
SORT date ASC
```
````

No `.base` files are shipped with this repo.

## Trust boundaries

Same honesty standard as [security.md](security.md):

| Surface                               | What you get                                                                                | What you do not get                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bank.conf` line parser               | Refuses obvious RCE shapes and non-`BANK_KEY=value` lines before ever writing a status file | A proof that the declared path/endpoint is itself safe, or that pushed content is sound |
| `bank-status.md`                      | A point-in-time reachability probe (+ advisory warnings)                                    | A guarantee the bank stays reachable until the push actually runs                       |
| `atry bank push` obsidian-vault write | Plain markdown files on disk at deterministic flat paths                                    | Confirmation your notes app indexed them, or that the notes are any good                |
| `atry bank set-status`                | Lifecycle fields updated in place                                                           | Edits to the run-dir snapshot, or validation of note body quality                       |

## Adding a real second backend later

If `lightrag-http` gets a driver, follow the pattern already used for
`obsidian-vault` in the bank scripts: one `case` branch in check that probes
reachability without mutating anything, and matching branches in push /
set-status that write. Keep the "record, don't enforce" posture — a failed
push is always a soft failure (exit `2`) for the calling skill, never a reason
to fabricate success.
