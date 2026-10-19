# Run Discovery

The discovery subsystem (`src/core/discover.ts`) locates `.agent-relay/` directories and parses directory name formats.

## Upward Traversal

When invoked in a sub-folder of a project, the CLI traverses upward through parent directories looking for an `.agent-relay/` directory:

1. Start at `cwd`.
2. Inspect if `.agent-relay/` exists and is a directory.
3. If not found, advance to the parent directory until reaching the filesystem root.
4. Throw `RelayError("not_found", ".agent-relay not found")` if no relay directory is discovered.

## Directory Name Parsing

Each run directory adheres to the schema:

`{YMD}-{id}-{slug}`

- `{YMD}`: 8-digit date string (`YYYYMMDD`).
- `{id}`: 10 or 11 numeric digits generated via timestamp and random seed.
- `{slug}`: Lowercase alphanumeric string with single hyphens (`^[a-z]+(-[a-z]+)*$`).

Helper functions extract these tokens safely:

- `runIdFromName(name)`
- `runSlugFromName(name)`
