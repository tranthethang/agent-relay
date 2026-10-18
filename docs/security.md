# Security and trust boundaries

This project is skill text plus a CLI. It is not a hardened supply-chain
product.

| Surface              | What you get                                      | What you do not get                          |
| -------------------- | ------------------------------------------------- | -------------------------------------------- |
| `npx skills add`     | Copies from the git tree `skills` resolves        | A review of that tree                        |
| `npm i -g`           | The published tarball, with provenance on publish | A guarantee the skill text is safe to follow |
| `tool` / `model`     | A record the agent wrote                          | Proof of which runtime ran                   |
| Cross-review warning | stderr when tool or model family matches          | A hard refuse                                |
| `claim` locks        | A per-task lock and a file-overlap check          | Protection for edits outside `files`         |
| Run lock             | Serializes CLI state changes and event appends    | A lock on direct repository edits            |
| Review tree check     | Compares the current tree with the latest review | Proof that an agent inspected every file      |
| Review waiver         | Records `--waive-review` and its reason           | Evidence that a person approved the waiver    |

`events.jsonl` is append-only only by convention of this CLI. Another process
can edit the file. `atry` validates the events it reads.

The tree check uses a temporary copy of the Git index and excludes
`.agent-relay/`. The real index stays unchanged. Review data such as `open`
and `fixed` still comes from JSON written by an agent.

Skills can tell an agent to edit the target repo. The host tool's sandbox is
the control for that. This repo does not add one.

Close and approve record `via=confirm` or `via=arg`. That records how the
agent says the person answered. It does not prove a person typed it.
