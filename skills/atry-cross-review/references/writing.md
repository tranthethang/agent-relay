## Language

Store one language tag, such as `en`, in `~/.agent-relay/lang`. Use that language when the file contains a tag. A missing or empty file means English (`en`). A language the user names in the session applies to that session only. Do not create or edit the language file unless the user asks.

## Sentences

Put one idea in each sentence. Use an imperative sentence for each task step. Use one term for one concept. Do not use idioms. Do not use a synonym for a glossary term. These rules follow the spirit of ASD-STE100. They do not claim ASD-STE100 compliance. Do not copy the ASD-STE100 word list.

## Glossary

Use these terms only for these meanings:

- `plan`: the `plan.md` for one run.
- `run`: one `.agent-relay/{YMD}-{id}-{slug}/` directory.
- `task`: one numbered item under `## Tasks`.
- `claim`: the `atry claim` lock on a task.
- `review`: self-review or cross-review of a run.
- `distill`: the `atry distill` manifest export.
- `approve`: human `atry approve` of a plan.
- `decide`: human `atry decide` for an open decision.
- `stamp`: human `atry stamp` of tool and model.
- `close`: human `atry close` of a run.

## Question card

Write each open question as one card. The same shape is used in a brainstorm and in a review report.

```markdown
- Q1: <question>
  - a. <smaller change>
  - b. <durable change>
- Q2: <question>
  - Need: <the data or check that is missing>
```

Rules:

- Start the question line at column 0 with `- Q<n>: `. Do not add a checkbox.
- Indent the option lines by two spaces, so they do not match a line that starts at column 0 with `- `.
- When the evidence supports two real options, give exactly two. Use `a` for the smaller change. Use `b` for the durable change. Do not add `c`.
- When the evidence does not support two real options, do not invent them. Write one `Need:` line instead. Say what data, file, or decision is missing.
- Keep each option to one line. Put the reason in the question line, not in the options.
- The user replies with `1a`, `2b`, or a free-text answer to a `Need:` line.
