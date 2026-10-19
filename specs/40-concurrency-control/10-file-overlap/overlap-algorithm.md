# File Overlap Algorithm

The overlap detection subsystem (`src/core/overlap.ts`) prevents concurrent editing conflicts between independent agent sessions.

## Matching Rules

Two path entries $P_1$ and $P_2$ overlap if:

1. **Exact Path Match**:
   $$P_1 = P_2$$
2. **Directory Containment**:
   $$P_1 \text{ is a prefix of } P_2 \text{ ending with } /$$
   $$\text{or } P_2 \text{ is a prefix of } P_1 \text{ ending with } /$$

### Examples

| Path 1              | Path 2             | Result   | Reason                              |
| ------------------- | ------------------ | -------- | ----------------------------------- |
| `src/core/plan.ts`  | `src/core/plan.ts` | Overlap  | Exact match                         |
| `src/core`          | `src/core/plan.ts` | Overlap  | Directory contains file             |
| `src/core-utils`    | `src/core`         | Disjoint | Prefix match without trailing slash |
| `test/plan.test.ts` | `src/core/plan.ts` | Disjoint | Distinct paths                      |

## Claim Check

When session $S_1$ claims or steals task $T_A$, the engine reads locks held by other sessions. If any file in $T_A$ overlaps any file in those tasks, the command throws `RelayError("lock", ...)`. A claim that fails this check deletes the lock it just created.
