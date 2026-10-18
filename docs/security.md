# Security and trust boundaries

This project is skill text plus a CLI. It is not a hardened supply-chain
product.

| Surface              | What you get                                      | What you do not get                          |
| -------------------- | ------------------------------------------------- | -------------------------------------------- |
| `npx skills add`     | Copies from the git tree `skills` resolves        | A review of that tree                        |
| `npm i -g`           | The published tarball, with provenance on publish | A guarantee the skill text is safe to follow |
| `tool` / `model`     | A claim locked to the review-start event          | Proof of which runtime or model ran          |
| `detected`           | A supported environment marker, such as Codex     | Proof that the declared model generated text |
| Test result          | Exit code and tree measured by `review done`      | Proof that tests cover the change            |
| Cross-review warning | stderr for matching vendor or model line          | A hard refuse                                |
| `decided` event      | Answer tied to a question and review path         | Proof that a person selected the answer      |
| `claim` locks        | A per-task lock and a file-overlap check          | Protection for edits outside `files`         |
| Run lock             | Serializes CLI state changes and event appends    | A lock on direct repository edits            |
| Review tree check     | Compares the current tree with the latest review | Proof that an agent inspected every file      |
| Review waiver         | Records `--waive-review` and its reason           | Evidence that a person approved the waiver    |

`events.jsonl` is append-only only by convention of this CLI. Another process
can edit the file. `atry` validates the events it reads.

The tree check uses a temporary copy of the Git index and excludes
`.agent-relay/`. The real index stays unchanged. Review data such as `open`
and `fixed` still comes from JSON written by an agent. `review done` compares
question cards with `open`, but it cannot prove an agent understood either.

The policy `testCommand` runs from the run's base commit through a platform
shell at the repository root. Treat that committed command as executable code.

Skills can tell an agent to edit the target repo. The host tool's sandbox is
the control for that. This repo does not add one.

Close and approve record `via=confirm` or `via=arg`. That records how the
agent says the person answered. It does not prove a person typed it. Actor is
`agent-env` for a detected supported environment and `unknown` otherwise.
