# Model & Tool Diversity Matrix

To ensure rigorous cross-review independence, the core review engine (`src/core/model.ts`) analyzes the relationship between the implementing model and the reviewing model.

## Diversity Checks

When conducting a cross-review, the engine checks two levels of similarity:

1. **Vendor Diversity**:
   - Maps model names to known vendors (e.g. OpenAI, Anthropic, Google).
   - If the implementing agent and reviewing agent share the same vendor, emits a warning:
     `warning: cross-review uses same vendor (<vendor>) as implementation`.

2. **Model Family Diversity**:
   - Strips trailing versions and variant suffixes (e.g. `claude-3-5-sonnet` vs `claude-3-opus`).
   - If models share the same architecture line, emits an additional warning:
     `warning: cross-review uses same model family (<family>)`.

These warnings do not block close, but remain permanently visible in `atry status` and event records.
