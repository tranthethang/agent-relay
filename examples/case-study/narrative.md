# Case study narrative (shaped demo)

This folder is an **illustrative** before/after for the agent-relay pipeline.
It is **not** claiming that the sample healthz artifacts under `examples/review-*.md`
found these bugs in a real run.

## Scenario

A small probe surface: public `healthz` plus an admin-only readiness detail
endpoint. The implementer shipped working-looking handlers with two issues.

## What self-review caught

**Swallowed errors in `healthz`.** The handler called `getReady()` but always
returned `200 ok` (including in `catch`), so failures and not-ready never
surfaced. Same-tool self-review (stronger model) flagged the always-200 path
and returned proper status codes from readiness and errors.

See `before.ts` → `healthz` vs `after.ts` → `healthz`.

## What only cross-review caught

**Authz gap on `adminReady`.** The handler checked “is signed in” but not
`role === "admin"`, so any authenticated user could read admin probe detail.
A different tool/model family in cross-review noticed the incomplete
authorization check; self-review had focused on the health path and missed it.

See `before.ts` → `adminReady` vs `after.ts` → `adminReady` (adds `403`).

## Takeaway

Self-review and cross-review catch different classes of bugs. Keeping one
neutral skill source and running stages across tools is the point of
agent-relay.
