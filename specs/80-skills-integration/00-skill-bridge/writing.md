## Language

Store one language tag, such as `en`, in `~/.agent-relay/lang`. Use that language when the file contains a tag. A missing or empty file means English (`en`). A language the user names in the session applies to that session only. If the user does not ask, do not create or edit the language file.

## Sentences

These rules apply to `en` only. They apply to `SKILL.md` text and to stage output.

- Put one idea in each sentence.
- Use an imperative sentence for each procedure step.
- A procedure sentence has 20 words or fewer. A description sentence has 25 words or fewer.
- Use active voice.
- Put a condition before its action.
- A paragraph has 6 sentences or fewer and one topic.
- Use one term for one concept. Do not use a synonym for a glossary term.
- Do not use idioms.
- Follow a rule whose purpose is not obvious with one line that starts with `Why:`.
- A `Why:` line names the failure that the rule prevents. It has 25 words or fewer.
- Do not add a `Why:` line to a plain procedure step.

These rules follow the spirit of ASD-STE100. They do not state ASD-STE100 compliance. Do not copy the ASD-STE100 word list.

## Glossary

Use these terms only for these meanings:

- `plan`: the `10-plan/` stage folder for one run.
- `run`: one `.agent-relay/{YMD}-{id}-{slug}/` directory.
- `stage`: plan, implement, self-review, or cross-review for one run.
- `stage folder`: `10-plan`, `20-implement`, `30-self-review`, `40-cross-review`, or `90-distill`.
- `task`: one item in `10-plan/index.json`.
- `task breakdown`: the files under `20-implement/`.
- `claim`: the `atry claim` lock on a task.
- `review`: one review pair in a review stage folder.
- `distill`: the manifest from `atry distill`.
- `approve`: `atry approve` of a plan.
- `close`: `atry close` of a run.
- `brainstorm notes`: `notes.md` in one `.agent-relay/brainstorms/{YMD}-{slug}/` directory.
- `events`: the append-only `events.jsonl` for one run.

## Question card

Write each open question as one card. Use the same shape in brainstorm notes and in a review file.

```markdown
- Q1: <question>
  - a. <smaller change summary>
    <one-line explanation for a>
  - b. <durable change summary> Recommended.
    <one-line explanation for b>
- Q2: <question>
  - Need: <the data or check that is missing>
```

Rules:

- Start the question line at column 0 with `- Q<n>: `. Do not add a checkbox.
- Indent the option lines by two spaces, so they do not match a line that starts at column 0 with `- `.
- When the evidence supports two real options, give exactly two. Use `a` for the smaller change. Use `b` for the durable change. Do not add `c`.
- When the evidence does not support two real options, do not invent them. Write one `Need:` line instead. Say what data, file, or decision is missing.
- Keep each option summary on the `- a.` or `- b.` line to one sentence.
- Add one explanation line under each option. Indent that line four spaces.
- When evidence leans to one option, append ` Recommended.` to that option summary line. When evidence is tied, say so in the question line and label neither option.
- The user replies with `1a`, `2b`, or a free-text answer to a `Need:` line.
- Copy each card into the scaffold `open` array.
- A choice card uses `q`, `a`, and `b`. Put each option summary in `a` and `b`, including ` Recommended.` when the markdown shows it.
- A need card uses `q` and `need`.
- Keep `schema` as `1`.
