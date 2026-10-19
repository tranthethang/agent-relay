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
