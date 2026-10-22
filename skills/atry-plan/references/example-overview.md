# Example plan

This example plans one small change. It shows the shape. It is not a template.

## Overview

## Goal

Add `--quiet` to `atry status` for scripts that read one line.

## Non-goals

Do not change the JSON output. Do not change an exit code.

## Decisions

Print `<name> <lifecycle>` on one line. Keep the table for the default call.

## Constraints

The flag applies to one run, not to the list. Keep `schema` as `1`.

## Tasks input

```json
{
  "schema": 1,
  "tasks": [
    {
      "title": "Add the quiet flag",
      "deps": [],
      "files": ["src/cli/commands.ts", "test/status.test.ts"]
    }
  ]
}
```

One task. `deps` is empty. `files` names both edits.

## Task file

`10-plan/T1.md` repeats the title, the detail, the acceptance, and the verify
command.
