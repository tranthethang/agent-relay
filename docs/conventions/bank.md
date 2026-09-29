## Knowledge bank (optional, project-level)

`.agent-relay/bank.conf`, `.agent-relay/bank-status.md`, and (when the
agentmemory sink has posted) `.agent-relay/bank-agentmemory-sent.tsv` live
at the `.agent-relay/` root, **not** inside a per-run directory — a bank
connection is a property of the target repo, not of one run. `bank.conf` is
parsed line-by-line (never sourced/eval'd) by `atry bank check`; see
[bank.md](bank.md) for the format, supported `BANK_TYPE` values, dual vault
lanes (`BANK_PATH`/`BANK_PROJECT_NAME` vs `BANK_ATRY_PATH`/`BANK_ATRY_NAME`),
status fields (`reachable` / `atry_reachable`, …), push partitioning by
`scope:`, the agentmemory sent ledger / retry behaviour, set-status
dual-path lookup, unset-atry skip, path-equal dedupe, `--vault-only`, and
what "reachable" does and does not mean. `atry-distill` is the only skill
that reads/writes these files. Note schema (including `run_id:` and lane
`scope:`): `skills/atry-distill/references/note-schema.md`.
