# Trust Boundaries & Data Tiers

The system models data trust across three explicit levels to prevent agent hallucinations or bypasses from compromising repository integrity.

## Trust Hierarchy

```text
+--------------------------------------------------------------+
| Level 1: System-Measured (High Trust)                       |
| Base commit hashes, tree hashes, test results, run locks.   |
| Gates strictly rely on Level 1 measurements.                |
+--------------------------------------------------------------+
                              ^
                              |
+--------------------------------------------------------------+
| Level 2: Agent-Reported (Validated Medium Trust)            |
| Task completions, review findings, model identifiers.       |
| Cross-referenced and locked against measured events.        |
+--------------------------------------------------------------+
                              ^
                              |
+--------------------------------------------------------------+
| Level 3: Unstructured Prose (Informational Trust)           |
| Markdown rationale, planning notes, agent explanations.     |
| Unparsed by CLI gates; intended solely for human inspection. |
+--------------------------------------------------------------+
```

## Guiding Rule for New Features

Whenever a property can be measured deterministically (e.g. lines changed, exit codes, modified paths), `atry` measures it directly rather than asking the agent to report it.
