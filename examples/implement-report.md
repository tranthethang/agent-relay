# implement-report.md (example)

## T1 — Add GET /healthz handler

- Files changed: `src/server/routes.ts`
- Assumptions: reuse the existing `app.get` style; no content-type override needed for plain text
- Risks / open issues: none

## T2 — Integration test

- Files changed: `src/server/routes.test.ts`
- Assumptions: test harness already boots the app via `createTestApp()`
- Risks / open issues: none

## T3 — Ops README

- Skipped: ops README has no probe list section to extend; left for a follow-up
