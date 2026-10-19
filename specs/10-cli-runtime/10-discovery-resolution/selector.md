# Run Selector

`selectRun` in `src/core/select.ts` turns a token into one run directory. `resolveRun` in `src/core/discover.ts` does the lookup.

## With a Token

1. If the token looks like a path and that directory's basename matches `{YMD}-{id}-{slug}`, return it.
2. If the token is a full run directory name and `.agent-relay/<token>` exists, return it.
3. If the token is a 10 or 11 digit id, return the one run with that id.
4. If the token is a slug of lowercase letters and hyphens, return the one run with that slug.
5. Any other token throws `RelayError("not_found", "run not found")`.
6. Zero matches throw `not_found`. More than one match throws `RelayError("ambiguous", "run is ambiguous")`. Both use exit code `3`.

The selector does not look for `run.json` or `events.jsonl` inside an arbitrary directory.

## With No Token

`selectRun` lists run directories under `.agent-relay/`.

- One run: return that directory.
- Zero runs: throw `RelayError("not_found", "run not found")`.
- More than one run: throw `RelayError("ambiguous", "run is ambiguous")`.

`atry status` with no token lists runs instead of selecting one. `atry next` and `atry context` require a token and throw `usage` when it is missing.
