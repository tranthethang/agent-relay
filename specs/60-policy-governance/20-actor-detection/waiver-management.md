# Review Waiver Management

When emergency hotfixes or deliberate non-standard flows require closing a run without meeting base review policies, operators may invoke review waivers (`src/core/lifecycle.ts`).

## Invocation

```bash
atry close <run> --waive-review "Hotfix approved directly by lead maintainer"
```

## Behavior

- Requires a non-empty explanation string.
- Appends a `waiver` event to `events.jsonl` with the stated reason.
- Bypasses missing review checks during `closeRun()`.
- Unreviewed code tree matches and unacknowledged reviewer deltas still enforce verification unless combined with `--ack-fixes`.
- The waiver status and reason display permanently in `atry status`.
