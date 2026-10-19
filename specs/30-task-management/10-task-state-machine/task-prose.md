# Task Prose Structure

Human and agent documentation for tasks is distributed across two stage directories:

## 1. Plan Description: `10-plan/T<n>.md`

Scaffolded by `atry plan done` and filled by the planning agent before plan approval:

```markdown
# T1: <Title>

## Detail

Detailed specification of the task requirements, expected behaviors, and edge cases to consider during implementation.
```

## 2. Implementation Report: `20-implement/T<n>.md`

Created during task execution and completed before calling `atry task done`:

```markdown
# T1: <Title>

## Files

- List of files modified, added, or deleted during task execution.

## Assumptions

- Foundational assumptions made by the implementing agent while writing the code.

## Extra Files (Optional)

- Any paths modified outside the task's declared files list, along with the required explanation reason.

## Risks

- Potential risks, edge cases, or regression considerations for the review stage.
```
