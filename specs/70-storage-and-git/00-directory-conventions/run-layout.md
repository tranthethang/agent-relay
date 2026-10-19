# Run Directory Layout

A run directory encapsulates all metadata, scaffolds, task reports, and reviews for a specific workflow instance.

## Path Structure

`.agent-relay/{YMD}-{id}-{slug}/`

```text
.agent-relay/20261019-1792385260-specs-refactor-structure/
├── events.jsonl                 # Immutable source-of-truth event ledger
├── run.json                     # Rebuilt state snapshot cache
├── locks/                       # Mutex and claim locks
│   ├── run.lock                 # Mutex lock while mutating run state
│   └── T1.lock                  # Task claim lock held by an agent session
├── 10-plan/                     # Planning stage artifacts
│   ├── overview.md              # Goals, decisions, constraints
│   ├── tasks.input.json         # Draft tasks input
│   ├── index.json               # Final validated task DAG
│   └── T1.md ...                # Task descriptions
├── 20-implement/                # Implementation reports
│   └── T1.md ...                # Task implementation files, assumptions, risks
├── 30-self-review/              # Self-review reports and test logs
│   ├── 01.md                    # Review findings and question cards
│   ├── 01.json                  # Review metadata and open items
│   └── 01.test.log              # Captured test command output
├── 40-cross-review/             # Independent cross-review artifacts
│   ├── 01.md
│   └── 01.json
└── 90-distill/                  # Run export artifacts
    └── manifest.json            # SHA-256 integrity manifest
```
