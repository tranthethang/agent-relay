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
- Use the writing rules in `specs/80-skills-integration/00-skill-bridge/writing.md` for plan overviews and review findings.
  Those rules recommend short sentences for skill text. They do not claim ASD-STE100 compliance.

### OpenAI Codex

- Codex environment threads are recognized automatically via `CODEX_THREAD_ID`.
- Approval and close commands log `actor: "agent-env"`.
