## Distill manifest

`atry distill <run>` writes `90-distill/manifest.json`. Distill is an export.
It does not close the run and it does not append a stage event. It works in
every run state.

```json
{
  "schema": 1,
  "files": [{ "path": "run.json", "size": 1, "sha256": "<64 hex chars>" }]
}
```

`path` is relative to the run directory and uses `/`. The manifest file itself
is omitted. Files are sorted by path. Re-running overwrites the manifest.
