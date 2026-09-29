# Knowledge bank (optional)

An **opt-in** connection from one target repo to external flat folder(s) of
typed markdown notes. After a run, `atry-distill` writes notes under
`$RUN_DIR/distill/`; `atry distill finalize` then runs bank check, metrics,
push, set-status, the Bank push line, and a vault-only re-push.
`atry bank push` copies notes flat into one or two
vault paths by note `scope:` — **project** lane (`BANK_PATH` /
`BANK_PROJECT_NAME`) vs **atry self-improve** lane (`BANK_ATRY_PATH` /
`BANK_ATRY_NAME`). This is project-level configuration — one bank config per
repo, declared once at `.agent-relay/bank.conf` — not per-run.

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
- Not enrichment from the vault path into plan / implement / review by bash.
  Skills may optionally query agentmemory via MCP when the host exposes it;
  nothing here calls MCP from `atry`. Local prior-run distill notes remain
  the only automatic on-disk skim for `atry-plan`.
- Not a guarantee of push success beyond a basic writability / health probe.
  `reachable: true` means "the declared path exists and is writable" (for
  `obsidian-vault`); `agentmemory_reachable: true` means the health endpoint
  answered successfully — not "your notes app indexed the file" or "the
  memory is searchable forever."
- Not a directory creator. Developers create `BANK_PATH` and
  `BANK_ATRY_PATH` themselves; atry never creates them or any subdirectory
  under them.

## `bank.conf`

### Creating it

Nothing creates `bank.conf` automatically; the installer does not touch
target repos. Two ways to make one:

- `atry bank init [<start-dir>] [--path <dir>] [--project <slug>] [--atry-path <dir>] [--atry-name <slug>] [--agentmemory-url <url>]`
  writes `.agent-relay/bank.conf` from the commented template
  [`scripts/runtime/bank.conf.example`](../scripts/runtime/bank.conf.example)
  (installed next to the other helpers). `--path` also sets
  `BANK_TYPE=obsidian-vault`; `--atry-path` / `--atry-name` turn on the atry
  lane block; keys without an option stay commented out. Values are checked
  with the same rules as `atry bank check` before anything is written. It
  refuses to overwrite an existing `bank.conf` (exit `1`), creates
  `.agent-relay/` if the repo has none yet, never creates vault folders (it
  only warns when a declared folder is missing), and runs `atry bank check`
  once at the end; its exit code is that check's.
- Copy the template by hand and remove the leading `# ` from the keys you
  want.

### Format

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
# project lane (domain notes: run / decision / convention / …)
BANK_PATH=/absolute/path/to/your/project-vault-folder
BANK_PROJECT_NAME=agent-relay
# atry lane (process / atry-workflow open-items); optional; independent block
BANK_ATRY_PATH=/absolute/path/to/your/atry-vault-folder
BANK_ATRY_NAME=agent-relay
# optional second sink (or sole sink if BANK_TYPE is omitted)
BANK_AGENTMEMORY_URL=http://127.0.0.1:3111
```

Two independent config blocks. Values may be equal when dogfooding (same
folder for both lanes); scripts treat equal absolute paths as one filesystem
write per filename and still set each note's `project:` from its lane name.
If `BANK_ATRY_PATH` / `BANK_ATRY_NAME` are unset, push does **not** copy
atry-lane notes into `BANK_PATH` — local `$RUN_DIR/distill/` still holds them.
When `BANK_ATRY_PATH` is set, `BANK_ATRY_NAME` must be a valid slug (else
check exits `1`). Symmetrically with the project lane: agentmemory uses the
lane's name when set; the vault sink needs its path.

| Key                    | Required       | Notes                                                                                                                         |
| ---------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `BANK_TYPE`            | for vault      | Backend id (see table below). May be omitted when only `BANK_AGENTMEMORY_URL` is set.                                         |
| `BANK_PATH`            | for vault      | Project-lane vault: existing writable directory; trailing `/` stripped by `atry bank check`                                   |
| `BANK_ENDPOINT`        | reserved       | For `lightrag-http` later                                                                                                     |
| `BANK_PROJECT_NAME`    | no             | Project-lane slug for note `project:` / tags and agentmemory `project`; invalid value = malformed (exit 1)                    |
| `BANK_ATRY_PATH`       | no             | Atry-lane vault: existing writable directory when set; trailing `/` stripped. Unset → skip atry vault copies                  |
| `BANK_ATRY_NAME`       | with atry path | Atry-lane slug; required (valid slug) when `BANK_ATRY_PATH` is set; used for note `project:` / tags and agentmemory `project` |
| `BANK_AGENTMEMORY_URL` | no             | `http(s)://host[:port]` only (trailing `/` stripped). Invalid URL = malformed (exit 1). Enables the agentmemory REST sink.    |

One more setting lives **outside** the file on purpose:

| Environment variable | Needed                                  | Notes                                                                                                          |
| -------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `AGENTMEMORY_SECRET` | only if the agentmemory server uses one | Sent as `Authorization: Bearer` by `bank check` / `bank push`. Never put it in `bank.conf` (may be committed). |

Duplicate `BANK_PROJECT_NAME` / `BANK_ATRY_NAME` values across repos are
intentional and never warned about. When `BANK_PROJECT_NAME` is unset,
`atry bank check` defaults `project_name` to the slugified basename of the
directory that contains `.agent-relay/` (`project_source: default`). When
set, `project_source: config`. Atry-lane name has no default: unset means
no atry name in status (`atry_name_source: none` / `config`).

| `BANK_TYPE`      | Status                  | What it needs                                                                                    |
| ---------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `obsidian-vault` | Implemented             | `BANK_PATH` — an existing, writable local directory (vault root, or any folder Obsidian watches) |
| `lightrag-http`  | Reserved, no driver yet | Would need `BANK_ENDPOINT` and real network egress from wherever the agent runs                  |

Declaring `lightrag-http` today is harmless: `atry bank check` records it as
`reachable: false` with a `detail` explaining there is no driver, and
`atry bank push` / `set-status` refuse the vault path (exit `2` unless
agentmemory is separately usable). The old reserved `agentmemory-cli` type is
gone; agentmemory is configured with `BANK_AGENTMEMORY_URL`, not a
`BANK_TYPE`.

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
bank_path: /absolute/path/to/your/project-vault-folder
bank_endpoint: 
project_name: agent-relay
project_source: config
reachable: true
atry_path: /absolute/path/to/your/atry-vault-folder
atry_reachable: true
atry_detail: vault directory exists and is writable
atry_name: agent-relay
atry_name_source: config
agentmemory_url: http://127.0.0.1:3111
agentmemory_reachable: true
agentmemory_detail: health ok
checked_at: 2026-09-17T08:00:00Z
detail: vault directory exists and is writable
check_warnings: 
push_warnings:
```

`project_source` is `config` when `BANK_PROJECT_NAME` is set, else `default`
(slugified repo-root basename) when a bank.conf exists, else `none` when
there is no bank.conf. `atry_name_source` is `config` when `BANK_ATRY_NAME`
is set, else `none`. When a vault path is reachable and its expected name is
set, notes already in that path whose frontmatter `project:` differs produce
an advisory warning on stderr and a `check_warnings:` token
(`foreign-project:<filename>`); exit remains `0`. Expected name is
`BANK_PROJECT_NAME` under `BANK_PATH` and `BANK_ATRY_NAME` under
`BANK_ATRY_PATH`. If both paths resolve to the same absolute directory,
check accepts either expected name (or matches note `scope` to choose the
expected name per file).

`agentmemory_*` lines are independent of vault `reachable:`. Check probes
`GET <BANK_AGENTMEMORY_URL>/agentmemory/health` with short curl timeouts when
the URL is set.

Warnings are split by the command that produced them: `atry bank check`
rewrites only `check_warnings:` and keeps `push_warnings:` from the last
push; `atry bank push` rewrites only `push_warnings:` and keeps
`check_warnings:`. Tokens are space-separated; an empty value means that
command's last run had none.

No `bank.conf` is a normal, supported state (`configured: false`), not an
error — most target repos will never set one up. A malformed `bank.conf`
(anything not `BANK_KEY=value`, unsafe characters, an invalid
`BANK_PROJECT_NAME` / `BANK_ATRY_NAME`, or `BANK_ATRY_PATH` set without a
valid `BANK_ATRY_NAME`) is a hard refusal: exit `1`, and `bank-status.md` is
overwritten with `reachable: false` (and atry fields cleared / false) so a
stale `reachable: true` cannot survive for push to trust.

Run it fresh before every push. Reachability can change between runs for
reasons check cannot detect on its own.

_Known limitation_: `[[ -w "$BANK_PATH" ]]` / `[[ -w "$BANK_ATRY_PATH" ]]`
tests writability via file permission bits. When running as `root`,
`[[ -w ]]` may report true even on a read-only mount. Treat reachability as
advisory in such environments.

## `atry bank push`

```bash
atry bank push [--vault-only] <start-dir> <notes-dir>
```

Validates **all** notes before writing any, then partitions by frontmatter
`scope:`:

| `scope`                      | Vault destination                            | agentmemory `project`                 |
| ---------------------------- | -------------------------------------------- | ------------------------------------- |
| `atry`                       | `BANK_ATRY_PATH` when `atry_reachable: true` | `BANK_ATRY_NAME` / `atry_name:`       |
| `project` or `module:<slug>` | `BANK_PATH` when `reachable: true`           | `BANK_PROJECT_NAME` / `project_name:` |

Every note must have a valid `scope` and a plain `run_id:` (run directory
basename without `.md`). Push refuses `type: process` without `scope: atry`,
and refuses a leftover `run:` wikilink field (no dual-read of the old shape).
Filename must match `{YMD}-{RUN_ID}-{SLUG}.md`, and `type` must be one of
`run`, `decision`, `convention`, `pitfall`, `open-item`, `process`. Any
validation failure exits `1` and writes nothing from this push.

When `BANK_PATH` and `BANK_ATRY_PATH` resolve to the same absolute directory,
push still performs a single filesystem write per filename. When atry path /
name are unset, atry-lane notes are not vault-copied and are not sent under
the project name — they stay in local `distill/` only (agentmemory still
receives them when AM is usable **and** `atry_name` is set).

Requires a fresh `bank-status.md` with `configured: true` and **at least
one usable sink** (project vault `reachable: true`, atry vault
`atry_reachable: true`, and/or `agentmemory_reachable: true`). Exit `2` only
when no sink is usable. Each sink reports on its own line; one failing never
skips the other. Exit `0` if at least one sink succeeded; exit `1` if every
usable sink failed during transfer (or a note failed validation before any
write).

`--vault-only` skips agentmemory for **both** vault lanes (project and atry);
used by `atry distill finalize` for its second push after the Bank push line.
Re-push overwrites the same vault filenames; agentmemory creates a new
memory per call when not skipped by the local sent ledger (below).

**Agentmemory POST failures.** A failed `remember` does **not** stop the
loop: remaining eligible notes are still attempted. Failed basenames are
listed on the `bank-push: agentmemory: failed (...)` stderr line, and the
agentmemory sink counts as failed for that push (exit `1` only when every
usable sink failed). Temp body / auth-header files are removed by a `trap`
(including on interrupt).

**Local sent ledger.** Successful agentmemory POSTs append one row to
`.agent-relay/bank-agentmemory-sent.tsv` (next to `bank-status.md`):

```text
url<TAB>project<TAB>filename<TAB>sha256-of-posted-body
```

On a later push, a note whose exact row (same server URL, project, filename
and body hash) is already present is skipped (stderr: `already in sent
ledger`). Changed note content produces a new body hash and is posted again
(a new memory — documented, not server-side deduped); pointing
`BANK_AGENTMEMORY_URL` at another server posts every note to that server.
The ledger lives in the target repo's `.agent-relay/` directory: if you
commit `.agent-relay/`, the ledger is committed with it; if you ignore it,
the ledger stays local.

Advisory (exit `0`): orphan notes in each vault path that share the pushed
run's `{YMD}-{RUN_ID}-` prefix but were not in this push (reported per path
prefix), and foreign `project` values — stderr plus `push_warnings:` in
`bank-status.md` (`check_warnings:` is left as the last check wrote it).

A failed or skipped push must never block distill from finishing: the run-dir
note copies remain the durable local record.

## `atry bank set-status`

```bash
atry bank set-status <start-dir> <filename> <status> [--by <filename>]
```

Edits **only** lifecycle fields on a note already in `BANK_PATH` or
`BANK_ATRY_PATH` (lookup: project path first, then atry path; the run-dir
copy stays a snapshot):

- `status` — must be allowed for the note's `type` (`run` notes are immutable
  and refuse any status change).
- With `--by <filename>` and status `superseded` → also sets `superseded_by`.
- With `--by <filename>` and status `resolved` → also sets `resolved_by`.

`<filename>` and `--by` are basenames matching the note filename rule, not
paths. The `--by` target must resolve on the **same** vault path as the
edited note (refuse cross-lane `--by`). The `--by` filename is stored as a
quoted wikilink (`superseded_by: "[[<filename-without-.md>]]"`) so Obsidian
links the versions within that lane. The body after the closing `---` is left
byte-identical, and the file is rewritten in place (permissions kept).

`atry bank push` refuses any note whose frontmatter does not open with `---`
on line 1 — Obsidian ignores properties anywhere else.

## Agentmemory (optional second sink)

[agentmemory](https://github.com/rohitg00/agentmemory) is an optional REST
(+ MCP) memory server. atry talks to it **only over REST from bash**; agents
read via their own MCP tools when the host exposes them. atry does not run,
install, or configure the server.

### Confirmed REST contract

Checked against agentmemory `@0.9.29` (`src/triggers/api.ts` /
`plugin/skills/agentmemory-rest-api`):

| Method | Path                    | Role in atry                                                                      |
| ------ | ----------------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/agentmemory/health`   | `atry bank check` reachability probe (HTTP 200 unless health is `critical` → 503) |
| `POST` | `/agentmemory/remember` | `atry bank push` — one call per eligible note                                     |

`POST /agentmemory/remember` body fields atry sends:

- `content` (required) — recall-oriented projection: `<type>: <key>` opener,
  blank line, then the markdown body (YAML frontmatter stripped). Vault and
  `$RUN_DIR/distill/` copies remain full notes.
- `project` — from the note's lane: `project_name:` for project /
  `module:*` notes, `atry_name:` for `scope: atry` notes (when non-empty)
- `type` — mapped to agentmemory's enum: `decision→architecture`,
  `convention→pattern`, `pitfall→bug`, `process→workflow`, `open-item→fact`
- `concepts` — from note `tags` (dropping `project/<name>` when `project` is
  set), plus `key:<slug>`, `status:<value>`, and `module:<slug>` when `scope`
  is `module:*`. Does not include `note-type:…`.
- `key`, `status`, `tags` are **not** sent as top-level fields.

**Eligibility.** Push skips notes for the agentmemory sink when:

- `type: run` — per-run metrics; not durable lessons
- `status` is not `active` or `open` (terminal: `superseded`, `deprecated`,
  `resolved`; empty or unknown status also skips)
- atry-lane note without `atry_name` set

Intentional skips are not failures; push still exits `0` when every note was
skipped.

Server-side, remember's own `type` enum is
`pattern|preference|architecture|bug|workflow|fact`; values outside that set
are stored as `fact`. Bodies are built with `python3` JSON encoding and sent
with `curl --data-binary @file` (never interpolated onto the command line).
`python3` is required only for this sink: when it is missing (for example the
macOS stub before Command Line Tools are installed), `atry bank check` records
`agentmemory_reachable: false` with a `python3 not available` detail, and the
vault sink is unaffected.

**Auth.** When the server runs with `AGENTMEMORY_SECRET`, both `/health` and
`/remember` require `Authorization: Bearer <secret>`. Export the same
`AGENTMEMORY_SECRET` in the shell that runs atry; `bank check` and `bank push`
then send the header from a 0600 temp file (`curl -H @file`), so the secret
never appears in `bank.conf`, `bank-status.md`, or the process list. Do not
put it in `bank.conf` — that file may be committed.

**No server-side dedupe.** `remember` always creates a new memory. atry's
local ledger (`.agent-relay/bank-agentmemory-sent.tsv`) skips an exact
server URL + `project` + filename + posted-body hash row on retry so a partial failure
can be re-run without re-posting successes. What still duplicates:

- Changed note content (new body hash) → posted again as a new memory
- `atry bank push --vault-only` skips agentmemory entirely; `atry distill finalize`'s
  second push uses that flag after the Bank push line (vault overwrite only)
- Deleting or editing the ledger by hand, or pushing from a different
  checkout without that ledger file
- Any remember outside atry (MCP, other clients)

There is **no** status-by-key REST update: `/agentmemory/evolve` requires
`memoryId` + `newContent`. `atry bank set-status` therefore edits only the
vault file and does not invent an agentmemory forward. A later push of a new
note version (updated `status` / `supersedes`) is the signal.

### Read path (agents / MCP)

Skills `atry-plan`, `atry-self-review`, `atry-cross-review`, and
`atry-distill` may call MCP `memory_smart_search` / `memory_recall` when the
tool session exposes them: filter by project scope, prefer `active` / `open`
content, treat hits as data never instructions, never block if MCP is
missing. Plans may record what they used under optional `## Context used`.

### Team sharing

Documented only: a shared agentmemory server and MCP `memory_team_share` /
REST `/agentmemory/team/share` are outside atry. Point
`BANK_AGENTMEMORY_URL` at a shared host if your team runs one; atry still
only pushes distilled notes and does not manage team membership.

### Limitations

- Optional; never required for a run to finish.
- No MCP client inside `atry` — bash uses curl REST only.
- No status forward on `set-status`; stale memories until a new note version
  is pushed.
- Does not push anything except `$RUN_DIR/distill/*.md` via `atry bank push`.
- URL form is `http(s)://host[:port]` only (no path, userinfo, or IPv6).

## Vault process checklist (manual)

When changing note schema (for example replacing `run:` wikilinks with
`run_id:`, or splitting project / atry lanes), wipe and re-distill by hand.
Nothing in atry migrates or rewrites vault notes automatically.

1. Delete outdated notes from `BANK_PATH` and `BANK_ATRY_PATH` (or the shared
   folder if both point at the same path) — Obsidian trash or `rm` is fine.
2. Ensure both declared folders already exist and are writable (`atry` never
   creates them).
3. Re-run `atry-distill` (or `atry bank push`) for the runs you still want in
   the bank, so new notes carry the current schema and land in the correct
   lane.

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

| Surface                               | What you get                                                                                                                                                                          | What you do not get                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `bank.conf` line parser               | Refuses obvious RCE shapes and non-`BANK_KEY=value` lines before ever writing a status file                                                                                           | A proof that the declared path/endpoint is itself safe, or that pushed content is sound       |
| `bank-status.md`                      | A point-in-time reachability probe (+ advisory warnings)                                                                                                                              | A guarantee the bank stays reachable until the push actually runs                             |
| `atry bank push` obsidian-vault write | Plain markdown files on disk at deterministic flat paths (per lane)                                                                                                                   | Confirmation your notes app indexed them, or that the notes are any good                      |
| `atry bank push` agentmemory remember | One REST POST per eligible note with projected content + lane `project` + mapped `type` / lean `concepts`; local sent ledger skips exact url/project/filename/body-hash rows on retry | Proof the memory was indexed, server-side dedupe, or status-by-key sync                       |
| `atry bank set-status`                | Lifecycle fields updated in place on the vault file (either lane)                                                                                                                     | Edits to the run-dir snapshot, agentmemory status forward, or validation of note body quality |

## Adding another backend later

If `lightrag-http` gets a driver, follow the pattern already used for
`obsidian-vault` and `BANK_AGENTMEMORY_URL`: probe reachability in check
without mutating anything, and matching write paths in push / set-status.
Keep the "record, don't enforce" posture — a failed push is always a soft
failure for the calling skill, never a reason to fabricate success. One sink
failing must not skip another.
