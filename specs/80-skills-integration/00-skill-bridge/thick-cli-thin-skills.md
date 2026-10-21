# Thick CLI, Thin Skills Architecture

The `agent-relay` framework is architected around the "Thick CLI, Thin Skills" principle.

## Motivation

Early AI agent workflows relied heavily on long markdown skill instructions explaining complex state machines, conditional branching rules, version comparisons, and file path validations. This approach led to:

1. **High Token Overhead**: Hundreds or thousands of tokens consumed on every turn just to hold workflow rules in context.
2. **Probabilistic Execution**: AI agents frequently miscalculated semver strings, forgot to check file overlap, or hallucinated lifecycle state transitions.
3. **Synchronization Drift**: Maintaining duplicated logic across multiple skill bundles was prone to drift.

## Solution

All lifecycle state validation, dependency checking, gate verification, and version comparisons were moved into the compiled TypeScript binary `atry`.

- Skill markdown files (`SKILL.md`) are reduced to concise procedural instructions.
- State and available actions are computed by `atry next`, which marks one option as its recommendation.
- Skills present multiple actions to the developer and follow the selected action.
- The agent reads the selected action's paths before running its command.
