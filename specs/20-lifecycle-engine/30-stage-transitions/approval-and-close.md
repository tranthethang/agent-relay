# Approval and Close Gates

`atry approve` and `atry close` serve as the boundary gates entering implementation and exiting a run.

## Approval Gate (`atry approve`)

- Requires option `--via <confirm|arg>`.
- Supports `--preview` to print the run goal, settled decisions, and task count without recording an approval event.
- Does not check the task count. `atry plan done` refuses a plan with more than 8 tasks.
- Records actor provenance (`agent-env` when running in recognized agent environments, otherwise `unknown`).

## Close Gate (`atry close`)

`atry close` strictly verifies the integrity of the code delivered by the run:

1. **Review Completeness**:
   - Compares completed reviews against repository policy (`.agent-relay.json`).
   - If reviews are missing, closes only if `--waive-review <reason>` is provided.

2. **Reviewed Code Tree Match**:
   - Compares the git working tree hash against the working tree hash recorded at the latest completed review.
   - Refuses if unreviewed changes were made to code after the latest review.

3. **Reviewer Modifications**:
   - If the reviewer modified code during review, requires `--ack-fixes` to confirm human awareness.

4. **Open Questions**:
   - If the latest review contains unresolved question cards, requires `--ack-open`.

5. **Preview**:
   - `atry close <run> --preview` prints the close readiness status and diagnostic warnings without closing the run.

6. **Worktree Removal**:
   - When a run has a worktree record, `close` checks if the run branch is merged and the working tree is clean.
   - If removal fails or unmerged changes remain, `close` reports `worktree: kept (<reason>)` while preserving run closure.
   - Successful removal appends a `cleaned` run event.

## Worktree Cleanup (`atry worktree cleanup`)

- `atry worktree cleanup <run>` retries removal of a merged worktree for a closed run.
- It validates the registered worktree and branch, verifies that the branch is merged into base, and checks that the working tree is clean.
- It returns repeatable results when the worktree is already absent, reconciling any missing `cleaned` event.
- It refuses active or abandoned runs to prevent accidental loss of uncommitted work.
