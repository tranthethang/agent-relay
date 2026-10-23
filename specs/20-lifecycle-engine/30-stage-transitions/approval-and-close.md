# Approval and Close Gates

`atry approve` and `atry close` serve as the boundary gates entering implementation and exiting a run.

## Approval Gate (`atry approve`)

- Requires option `--via <confirm|arg>`.
- Reads `10-plan/overview.md` and `10-plan/index.json`. It refuses with exit 4, and records no event, when the index is missing, the index has zero tasks, or a task file has an empty `## Detail` or `## Acceptance` section.
- Supports `--preview` to print the goal, non-goals, constraints, decisions, each task file, and `ready: yes` or `ready: no` with the missing items. The preview records no event and does not throw for an incomplete plan.
- `atry stage start <run> implement` applies the same readiness check.
- Does not apply the eight-task limit. `atry plan done` applies it when `strict.plan` is true.
- Records actor provenance (`agent-env` when running in recognized agent environments, otherwise `unknown`).

## Close Gate (`atry close`)

`atry close` checks the integrity of the code delivered by the run:

- With `strict.reviewIntegrity: true`, every integrity problem blocks close unless its existing acknowledgement or waiver option applies.
- With `strict.reviewIntegrity: false`, the remaining integrity problems appear in the close preview. A close command with `--via` also collects them as warnings. It refuses and lists them until `--ack-warnings` is present, then closes and records the warnings in the close event. `--ack-warnings` never bypasses `strict.reviewIntegrity: true`.
- The open-question check and the cross-delta rule run for every close, in both modes.

1. **Review Completeness**:
   - Compares completed reviews against repository policy (`.agent-relay.json`).
   - In strict mode, if reviews are missing, close requires `--waive-review <reason>`.

2. **Reviewed Code Tree Match**:
   - Compares the git working tree hash against the working tree hash recorded at the latest completed review.
   - In strict mode, refuses if unreviewed changes were made to code after the latest review.

3. **Reviewer Modifications**:
   - The preview names a reviewer delta as `changes made during the latest review`.
   - In strict mode, close requires `--ack-fixes` to confirm human awareness.
   - In a soft close, `--ack-warnings` accepts the delta. `--ack-fixes` does not replace `--ack-warnings`.

4. **Open Questions**:
   - If the latest review contains unresolved question cards, close fails with field `open` and exit 4.
   - `--ack-open` accepts the questions and adds no warning.
   - A soft close also needs `--ack-open`, even when `--ack-warnings` is present.

5. **Cross-Review Delta**:
   - When the latest cross-review recorded a delta and no self-review completed after it, close fails with field `review.self` and exit 4.
   - `--ack-warnings` and `--ack-fixes` do not bypass this rule. Complete a self-review first.
   - `atry next` recommends `atry review new <run> self` in this state.

6. **Preview**:
   - `atry close <run> --preview` prints the close readiness status and diagnostic reasons without closing the run.

7. **Worktree Removal**:
   - When a run has a worktree record, `close` checks if the run branch is merged and the working tree is clean.
   - If removal fails or unmerged changes remain, `close` reports `worktree: kept (<reason>)` while preserving run closure.
   - Successful removal appends a `cleaned` run event.

## Worktree Cleanup (`atry worktree cleanup`)

- `atry worktree cleanup <run>` retries removal of a merged worktree for a closed run.
- It validates the registered worktree and branch, verifies that the branch is merged into base, and checks that the working tree is clean.
- It returns repeatable results when the worktree is already absent, reconciling any missing `cleaned` event.
- It refuses active or abandoned runs to prevent accidental loss of uncommitted work.
