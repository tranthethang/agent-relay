1. Run `atry next <run> --json`.
2. Stop when `actions` is empty, or when the `kind` of the recommended action is not one this skill handles.
3. Replace `<tool>` and `<model>` in its `command`. Change no other token.
4. When `needsHuman` is false, run the command. Then go to step 1.
5. When `needsHuman` is true and the command ends in `--preview`, run it with `--json` and read `decision`.
6. Show `decision.question`, or the action `question` when the command has no preview. Ask the developer to answer `y` or `n`. A `yes` token in the skill call counts as `y`.
7. On `y`, run `decision.onYes`. Run `decision.onYesArg` for a `yes` token. Run the action `command` when it has no preview. Stop when the field is `null`. Then go to step 1.
8. On `n`, stop and record no event.
