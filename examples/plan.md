base: 0000000000000000000000000000000000000000

# Feature: Add healthcheck endpoint

## Goal

Expose `GET /healthz` that returns `200` with body `ok` so load balancers can
probe the service without hitting business logic.

## Constraints

- No auth on this route
- Keep the handler dependency-free (no DB)
- Match existing router style in `src/server/`

## Tasks

1. Add the route next to the other top-level probes
1. Add a unit/integration test that hits `/healthz`
1. Document the probe in the ops README one-liner list
