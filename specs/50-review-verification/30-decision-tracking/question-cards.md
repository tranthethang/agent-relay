# Open Question Cards

Open items in review narratives and brainstorm notes adhere to a strict card format parseable by the CLI (`src/core/review.ts`).

## Card Format

Questions must start at column 0 with `- Q<n>: ` (no checkboxes):

### 1. Two-Choice Card

Used when evidence supports two real alternatives (option `a` for the smaller change, option `b` for the durable change):

```markdown
- Q1: Which hashing algorithm should we use for file manifests?
  - a. Use md5 for faster local checksums.
  - b. Use sha256 for cryptographic verification and collision resistance.
```

### 2. Information Need Card

Used when required information or verification checks are missing:

```markdown
- Q2: What is the maximum throughput threshold expected in production?
  - Need: Production load test metrics from the operations team.
```

## Parsing Rules

- Lines starting with `- Q<n>:` at column 0 are matched via regex.
- `atry review done` compares the number of Markdown question cards with the length of the `open` array in the JSON file.
- A mismatch between Markdown and JSON cards immediately refuses review completion.
