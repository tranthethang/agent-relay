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

`npm run check` runs dprint and `tsc --noEmit`. CI does the same. CI does not
prove that an agent follows a skill.
