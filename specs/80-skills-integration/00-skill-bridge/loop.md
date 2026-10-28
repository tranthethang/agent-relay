1. Run `atry next <run> --json`.
2. Stop when `actions` is empty, or when the `kind` of the recommended action is not one this skill handles.
3. When `actions` length is greater than one, list each action `command` with its `reason`. Mark the action whose `command` equals `recommendation` with `Recommended.`. Stop until the developer picks one action. Use that action for the steps below.
4. Read every path in the chosen action `read` array, or in top-level `read` when the action has no `read` field.
5. Replace `<tool>` and `<model>` in its `command`. Change no other token.
6. When the chosen action has `needsHuman` false, run the command. Then go to step 1.
7. When the chosen action has `needsHuman` true and the command ends in `--preview`, run it with `--json` and read `decision`.
8. Show `decision.question`, or the action `question` when the command has no preview. Ask the developer to answer `y` or `n`. A `yes` token in the skill call counts as `y`.
9. On `y`, run `decision.onYes`. Run `decision.onYesArg` for a `yes` token. Run the action `command` when it has no preview. Stop when the field is `null`. Then go to step 1.
10. On `n`, stop and record no event.
