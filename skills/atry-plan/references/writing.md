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

Give each open question exactly two options. Use `a` for the smaller change. Use `b` for the durable change. Do not add `c`. The user replies with `1a`, `2b`, and so on. Indent the option lines so they do not match a line that starts at column 0 with `- `.

Use this shape in a brainstorm:

```markdown
- [ ]1. <question>
  - a. <smaller change>
  - b. <durable change>
```

Use this shape in a review report. Do not add a checkbox:

```markdown
- 1. <question>
  - a. <smaller change>
  - b. <durable change>
```
