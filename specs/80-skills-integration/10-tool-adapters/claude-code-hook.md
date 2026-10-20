# Claude Code Edit Hook

`src/core/hook.ts` and `src/cli/hook.ts` add an opt-in runtime check for Claude Code edits.

## Install

`atry hook install --tool claude-code` writes `<git root>/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write|NotebookEdit",
        "hooks": [{ "type": "command", "command": "atry hook check" }]
      }
    ]
  }
}
```

- Existing keys and hooks stay in the file.
- When any `PreToolUse` entry already runs `atry hook check`, the result is `present` and the file does not change.
- Invalid JSON, a non-object `hooks`, or a non-array `hooks.PreToolUse` refuses with a validation error.
- Only `claude-code` is accepted. The command never writes user-level settings and never stages the file.

## Check

`atry hook check` reads the hook JSON on stdin:

| Field                      | Use                                        |
| -------------------------- | ------------------------------------------ |
| `cwd`                      | Start of the `.agent-relay` search         |
| `tool_input.file_path`     | Edited path, absolute or relative to `cwd` |
| `tool_input.notebook_path` | Edited notebook when `file_path` is absent |

1. No path, no `.agent-relay` folder, or no run in `implementing`: print nothing.
2. `guardPath` allows the path for any implementing run: print nothing.
3. Otherwise print a `hookSpecificOutput` object with `hookEventName: "PreToolUse"`.
   `permissionDecision` is `deny` when any implementing run has `strict.scope: true` in its base policy. Otherwise it is `ask`.
   `permissionDecisionReason` names the path and the runs.

The command always exits 0. Any error prints nothing and allows the edit, so a broken check does not stop work.

## Limits

- Paths are compared as given. A path through a symlinked folder can look outside the repo, as with `atry guard`.
- Shell commands that write files do not pass through the hook.
