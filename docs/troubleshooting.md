# Troubleshooting

| Symptom                                           | Likely cause                                   | What to do                                   |
| ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `atry: command not found`                         | The npm bin is not on `PATH`                   | `npm i -g @tranthethang/agent-relay`         |
| Skill version check stops                         | Installed `atry` is older than `requires-atry` | Install `@latest`                            |
| `atry version` prints `lib=…/.agent-relay/lib`    | The old bash `atry` is earlier on `PATH`       | Delete `~/.local/bin/atry`, `~/.agent-relay` |
| `implement start refused: plan is not approved`   | `atry approve` has not run                     | Approve in chat, then retry                  |
| `close refused: latest review has open questions` | The newest review JSON has `open` entries      | Answer them, or close with `--ack-open`      |
| `required self review is missing`                  | No completed self-review exists                 | Run `atry review new` and `atry review done` |
| `required cross review is missing`                 | Policy requires a cross-review                  | Complete a cross-review, then retry close    |
| `latest review tree does not match current tree`   | Code changed after the latest completed review  | Review the current code, then retry close     |
| `latest review has unacknowledged fixes`           | The reviewer changed code after review start    | Show the delta; after user approval, use `--ack-fixes` |
| `run lock timed out`                               | Another CLI state change holds the run lock     | Wait for it to finish, then retry             |
| `.agent-relay.json:...`                            | The committed policy is invalid                 | Fix the field and commit the policy at the run base |
| `claim` exits 5                                   | Another session holds an overlapping path      | Release that claim, or pick a disjoint task  |
| `plan has more than 8 tasks`                      | The plan gate                                  | Split the plan                               |
| `skills add` fails for one agent                  | That agent has no global skill directory       | Pass `-a` for the agents you use             |

`atry` errors name a field path, for example `tasks[0].deps[0]: unknown id T9`.
Fix that field and run the verb again.
