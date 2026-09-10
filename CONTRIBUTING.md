# Contributing

Thanks for considering a contribution to `team-freeze-guard`.

## Getting started

```sh
npm ci
```

## Development workflow

Before opening a pull request, make sure the following all pass:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm run build` compiles `src/` into `dist/index.js` via `@vercel/ncc`. This action ships its compiled output, so if you change anything under `src/`, run the build and commit the resulting changes in `dist/`.

## Pull requests

- Keep changes focused; unrelated fixes should be their own PR.
- Update `README.md` or `docs/` if you change behavior, inputs, or outputs.
- Add or update tests under `test/` for any behavior change.
- Fill out the PR template checklist.

## Reporting issues

Please use the issue templates in `.github/ISSUE_TEMPLATE` to report bugs or request features.
