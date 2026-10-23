# Plan Amendment Logic

When new requirements or unforeseen work emerge after `atry plan done`, the planning agent amends the task set using `atry plan amend <run>` (`src/core/plan.ts`).

## Amendment Invariants

1. **ID Preservation**:
   - Existing tasks retain their assigned identifiers (`T1`, `T2`, etc.).
   - All previously existing titles in `tasks.input.json` must match identically.
   - Deleting or reordering existing tasks is strictly rejected.

2. **Appending Only**:
   - New tasks are appended to the end of the `tasks` array.
   - New task identifiers increment sequentially from the highest existing ID.
   - Total task count must not exceed eight (8).

3. **Scaffold Generation**:
   - `atry plan amend` scaffolds `10-plan/T<n>.md` files for the newly added tasks without overwriting existing task files.
   - Every scaffold carries an empty `## Detail` and `## Acceptance` heading. The task file is not ready until both hold text.
   - `atry plan amend` refuses a task list with zero tasks.

4. **Approval Reset**:
   - In `approved`, `atry plan amend` appends a `plan` `completed` event. The reducer sets `approved: false` and `lifecycle: "planned"`, so the run needs `atry approve` again.
   - In `implementing`, `atry plan amend` keeps the lifecycle and stage. The new task starts pending.
