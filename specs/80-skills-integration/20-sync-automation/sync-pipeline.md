# Reference Synchronization Pipeline

Shared convention parts and partial texts are maintained in canonical locations under `specs/` and synchronized into distributed skill bundles via `scripts/maint/sync-references.ts`.

## Pipeline Flow

```mermaid
graph TD
    Specs[specs/70-storage-and-git/00-directory-conventions/ and specs/80-skills-integration/00-skill-bridge/] --> Script[scripts/maint/sync-references.ts]
    Script --> Brainstorm[skills/atry-brainstorm/references/]
    Script --> Plan[skills/atry-plan/references/]
    Script --> Implement[skills/atry-implement/references/]
    Script --> SelfReview[skills/atry-self-review/references/]
    Script --> CrossReview[skills/atry-cross-review/references/]
    Script --> Distill[skills/atry-distill/references/]
```

## CI Verification

Continuous Integration runs:

```bash
npm run sync:check
```

- Verifies that no manual edits were made directly to bundle references.
- Checks `skills/*/references/` in this repository. It does not update skills installed under a home directory.
- Fails with exit code `1` if drift is detected.
