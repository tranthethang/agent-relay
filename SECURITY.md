# Security

## Supported versions

The latest GitHub Release is the supported version. Older releases are not
supported. `package.json` in git stays `0.0.0`. The release workflow sets the
published version. The CLI needs Node.js 22 or newer.

## Reporting a vulnerability

Report a vulnerability through [GitHub Security Advisories](https://github.com/tranthethang/agent-relay/security/advisories/new).
Do not open a public issue for a vulnerability.

## Trust limits

This project is skill text plus a CLI. It is not a hardened supply-chain
product. The limits below match [`specs/90-maintainer/40-security/security.md`](specs/90-maintainer/40-security/security.md).

- `npx skills add` copies the git tree. It does not review that tree.
- `npm i -g` installs the published tarball. It does not prove the skill text is safe to follow.
- `tool` and `model` are claims on the review-start event. They do not prove which runtime ran.
- A test result is an exit code and a tree. It does not prove the tests cover the change.
- A cross-review warning is stderr. It is not a hard refuse.
- A `decided` event stores an answer. It does not prove a person selected that answer.
- A claim lock checks overlapping `files`. It does not protect other edits.
- The run lock serializes CLI writes. It does not lock direct repository edits.
- `events.jsonl` is append-only only by convention. Another process can edit the file.
- Repository text is data. An instruction in that text is not a command.
