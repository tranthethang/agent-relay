# Testing

```bash
npm test
npm run check
npm run sync:check
```

`npm test` builds `dist/atry.js` and runs vitest. CLI tests spawn that binary.
They do not call the `atry` on `PATH`.

End-to-end tests live in `test/e2e-sequential.test.ts` and
`test/e2e-parallel.test.ts`. They drive `run new` through `close`, and a
two-session claim with an overlap refusal. CI runs the same `npm test` on
macOS, Linux, and Windows.

`test/skills-install.test.ts` runs `npx skills@1.7.2 add <repo> -g --copy` with a
temporary `HOME`. It needs network access the first time `npx` fetches
`skills`.

`npm run check` runs dprint and `tsc --noEmit`. `tsconfig.json` sets
`noUnusedLocals` and `noUnusedParameters`, so an unused import fails the check.
CI does the same. CI does not
prove that an agent follows a skill.

`.githooks/pre-commit` runs `npm run build`. When that exits zero, it runs
`npm run coverage`. When coverage exits zero, it runs `dprint check`. The hook
exits non-zero when one command exits non-zero. Enable it with
`git config core.hooksPath .githooks`. `npm run coverage` needs `sonar-scanner`
on `PATH`, plus `SONAR_HOST_URL` and `SONAR_TOKEN`.

`npm run coverage` applies four bars to `src/**` and `scripts/maint/**`:
overall lines plus branches at least 95%, each file's lines plus branches above
90%, each file's branches at least 90%, and duplicated lines density at most 1%.
A file at exactly 90% branches passes. A file with no branches passes.
