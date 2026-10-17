# Troubleshooting

| Symptom                                           | Likely cause                                   | What to do                                   |
| ------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `atry: command not found`                         | The npm bin is not on `PATH`                   | `npm i -g @tranthethang/agent-relay`         |
| Skill version check stops                         | Installed `atry` is older than `requires-atry` | Install `@latest`                            |
| `atry version` prints `lib=…/.agent-relay/lib`    | The old bash `atry` is earlier on `PATH`       | Delete `~/.local/bin/atry`, `~/.agent-relay` |
| `implement start refused: plan is not approved`   | `atry approve` has not run                     | Approve in chat, then retry                  |
| `close refused: latest review has open questions` | The newest review JSON has `open` entries      | Answer them, or close with `--ack-open`      |
| `claim` exits 5                                   | Another session holds an overlapping path      | Release that claim, or pick a disjoint task  |
| `plan has more than 8 tasks`                      | The plan gate                                  | Split the plan                               |
| `skills add` fails for one agent                  | That agent has no global skill directory       | Pass `-a` for the agents you use             |

`atry` errors name a field path, for example `tasks[0].deps[0]: unknown id T9`.
Fix that field and run the verb again.
