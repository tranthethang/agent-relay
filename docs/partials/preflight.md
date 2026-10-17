This skill needs `requires-atry` in its front matter.
Run `atry version --json` before any other command in this skill.
Stop when the output is not a JSON object with `schema` and `version`, and tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
Read the `version` string from that JSON.
Split both versions on `.` and compare the numbers from the left.
Find the first pair of numbers that differ. Ignore the numbers after that pair.
Stop when the required number in that pair is higher than the installed number.
Tell the user to run `npm i -g @tranthethang/agent-relay@latest`.
Do not search the filesystem for helpers.
Do not run files under `scripts/` or `~/.agent-relay/lib/`.
When this skill names a run, call `atry context <run> --json` first.
