# Knowledge bank (optional)

An **opt-in** connection from one target repo to an external place where
`atry-distill` records lessons (pushing the full `distillation.md` note) after a
run finishes. This is project-level configuration — one bank per repo, declared
once at `.agent-relay/bank.conf` — not per-run.

This is not a runtime and does not run in the background. Nothing here
polls, syncs, or watches the bank. `atry bank check` and `atry bank push` are
one-shot helpers an agent runs when a skill tells it to.

## What this is not

- Not RAG, not embeddings, not search. It writes a plain markdown note; what
  you do with it in your bank (index it, embed it, feed it to a retrieval
  pipeline) is entirely up to your own tooling.
- Not enrichment of the other three stages (plan / implement / review) in
  this MVP. Nothing here reads the bank back into a prompt. That is a
  possible future addition, not implemented today — do not tell a user this
  repo already does it.
- Not a guarantee of push success beyond a basic writability check.
  `reachable: true` means "the declared path exists and is writable" (for
  `obsidian-vault`), not "your notes app actually indexed the file."

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
BANK_PATH=/absolute/path/to/your/vault
```

| `BANK_TYPE`       | Status                  | What it needs                                                                                         |
| ----------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `obsidian-vault`  | Implemented             | `BANK_PATH` — an existing, writable local directory (your vault root, or any folder Obsidian watches) |
| `lightrag-http`   | Reserved, no driver yet | Would need `BANK_ENDPOINT` and real network egress from wherever the agent runs                       |
| `agentmemory-cli` | Reserved, no driver yet | Would need a resolvable CLI command; not wired up                                                     |

Declaring `lightrag-http` or `agentmemory-cli` today is harmless: `atry bank check`
records them as `reachable: false` with a `detail` explaining there is no
driver, and `atry bank push` refuses (exit `2`) rather than pretending to push.
This is intentional — a stub push that silently no-ops would defeat the
config check having any use at all.

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
bank_path: /absolute/path/to/your/vault
bank_endpoint: 
reachable: true
checked_at: 2026-09-17T08:00:00Z
detail: vault directory exists and is writable
```

No `bank.conf` is a normal, supported state (`configured: false`), not an
error — most target repos will never set one up. A malformed `bank.conf`
(anything not `BANK_KEY=value`, or a value with the unsafe characters above)
is a hard refusal: `atry bank check` still exits `1` (so a caller/script that
checks the exit code learns something needs fixing), and it also
**overwrites `bank-status.md`** with `reachable: false` and a `detail`
naming the offending line, in the same step, before exiting. Refusing to
parse further (the exit code) and recording the truth (the status file) are
deliberately independent: a config regression can never leave a stale
`reachable: true` behind for `atry bank push` to trust. Same refuse-rather-
than-guess posture as `targets.conf`'s allowlist, just without the
side effect of also going silent about the current state.

Run it fresh before every push regardless. Reachability can change between
runs for reasons `atry bank check` has no way to detect on its own (the vault
path moves, a drive unmounts) — `bank-status.md` is only ever as current as
the last time this script actually ran.

_Known limitation_: `[[ -w "$BANK_PATH" ]]` tests writability via file
permission bits. When running as `root` (e.g. in some container or CI
environments), `[[ -w ]]` reports true even if the target filesystem is mounted
read-only. Treat reachability as advisory in such environments.

## `atry bank push`

```bash
atry bank push <start-dir> <run-id-or-slug> <title> <body-file-or-->
```

Refuses (exit `2`, not a hard failure) unless the most recent
`bank-status.md` says `configured: true` and `reachable: true`. For
`obsidian-vault`, writes `<BANK_PATH>/agent-relay/<YYYYMMDD>-<run-id>-<slug>.md`
with a small frontmatter block (`source`, `run`, `date`) and the given body
(per `atry-distill`, this is always the complete `$RUN_DIR/distillation.md`
note, not a condensed summary or a note with links back to the run directory).
Never overwrites an existing bank note with a different run id — the
filename includes the run id specifically to avoid collisions across runs on
the same day. Conversely, re-running `atry bank push` for the same run id and
title overwrites that run's existing bank note at the same deterministic path
rather than versioning or appending.

A failed or skipped push must never block `atry-distill` from finishing:
`$RUN_DIR/distillation.md` is the durable record regardless of whether the
push happened. See that skill's `SKILL.md` for how it reports the outcome.

## Trust boundaries

Same honesty standard as [security.md](security.md):

| Surface                               | What you get                                                                                | What you do not get                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `bank.conf` line parser               | Refuses obvious RCE shapes and non-`BANK_KEY=value` lines before ever writing a status file | A proof that the declared path/endpoint is itself safe, or that pushed content is sound |
| `bank-status.md`                      | A point-in-time reachability probe                                                          | A guarantee the bank stays reachable until the push actually runs                       |
| `atry bank push` obsidian-vault write | A plain markdown file on disk at a deterministic path                                       | Confirmation your notes app indexed it, or that the note is any good                    |

## Adding a real second backend later

If `lightrag-http` or `agentmemory-cli` gets implemented, follow the pattern
already used for `obsidian-vault` in both scripts: one `case` branch in
`atry bank check` that probes reachability without mutating anything, and one
`case` branch in `atry bank push` that writes/POSTs the note. Keep the "record,
don't enforce" posture — a failed push is always a soft failure (exit `2`)
for the calling skill, never a reason to fabricate success.
