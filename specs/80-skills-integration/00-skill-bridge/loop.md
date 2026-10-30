1. Run `atry next <run> --json`.
2. Stop when `actions` is empty.
3. When the user invoked this skill by name, find the action whose `command` equals `recommendation`. If this skill handles that action's `kind`, choose it and skip step 4.
4. When one action remains, choose it. When several actions remain, list each `command` with its `reason`. Do not label an action by stage name only. Mark the recommended action with `Recommended.`. Stop until the developer picks one. Choose that action.
5. When the chosen action's `kind` is not one this skill handles, stop.
6. Read every path in the chosen action `read` array, or in top-level `read` when the action has no `read` field.
7. Replace `<tool>` and `<model>` in its `command`. Change no other token.
8. When the chosen action has `needsHuman` false, run the command. Then go to step 1.
9. When the chosen action needs a human and its command ends in `--preview`, run it with `--json`. Read `decision`. Show `decision.question`, or show the action `question` when the command has no preview. Ask the developer for `y` or `n`. A `yes` token in the skill call counts as `y`.
10. On `y`, run `decision.onYes`. Run `decision.onYesArg` for a `yes` token. When the action has no preview, run its `command`. When the field is `null`, stop. Otherwise, go to step 1.
11. On `n`, stop and record no event.
