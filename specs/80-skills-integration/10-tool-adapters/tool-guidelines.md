# Tool Adapters & Guidelines

`agent-relay` is designed to be tool-agnostic while recognizing distinct operational environments.

## Supported Tool Identifiers

When executing stages or reviews, tools declare their identifier via `--tool <name>`:

- `cursor`
- `claude-code`
- `antigravity`
- `codex`
- `cowork`
- `kiro`
- `unknown`

## Tool Best Practices

### Claude Code

- Installed skill bundles live at `~/.claude/skills/atry-*`.
- Claude Code reads installed bundles rather than editing files directly inside `skills/` during runs.

### Antigravity

- Antigravity executes commands natively via `run_command` and tracks progress through long-running workflow sessions.
- Antigravity adheres to ASD-STE100 writing guidelines when drafting plan overviews and review findings.

### OpenAI Codex

- Codex environment threads are recognized automatically via `CODEX_THREAD_ID`.
- Approval and close commands log `actor: "agent-env"`.
