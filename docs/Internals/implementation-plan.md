# Implementation plan

Working plan for building the `team-freeze-guard` action from the design docs. This file is meant to be read cold by whoever (human or agent) picks up the next PR — it should always reflect current status, not just the original intent.

**How to use this file:** before starting a PR, read its section below plus the specific design-doc sections it links to — you don't need to re-read every doc from scratch. After a PR merges, check its box and note any deviation from the plan directly under that PR's heading (don't silently drift — if reality differs from the plan, write down why, since that's exactly the kind of thing a future reader can't infer from the diff alone).

## Status

- [x] PR 1 — Project scaffolding
- [ ] PR 2 — Config parsing and validation
- [ ] PR 3 — Decision engine (pure, no network)
- [ ] PR 4 — Participant identity resolution (GitHub API adapter)
- [ ] PR 5 — Team membership resolution (GitHub API adapter)
- [ ] PR 6 — Action entrypoint: wiring, reporting, fail-closed policy
- [ ] PR 7 — Bundling pipeline and policy-file protection
- [ ] Manual end-to-end verification (not a PR — see bottom)

## Context

Before this plan, the repo contained only design docs — no code. The docs are the spec, not just background reading:

- `README.md` — public contract: config fields (`bypass-labels`, `frozen-teams`), workflow example, permissions, expected-behavior matrix, ruleset rollout.
- `docs/Internals/README.md` — team-membership resolution strategy, the canonical decision algorithm, check reporting rules, fail-closed error list, event coverage table.
- `docs/Internals/architecture.md` — composite-action structure, trusted-execution rules for `pull_request_target`, why config comes from workflow `with:` inputs (not a checked-out file).
- `docs/Internals/participant-identity-resolution.md` — exact rule for building the participant set (PR author + GitHub-linked commit author/committer logins only, unmapped identities are warnings not participants).
- `docs/Internals/octo-sts.md` — Octo STS trust policy shape (org-scoped `Members: read` token).
- `docs/Internals/testing.md` — required unit vs. integration test coverage.
- `docs/limitations.md` — known gaps to *not* try to silently solve mid-implementation (reconciliation on config/membership change, label authorization, `Co-authored-by` trailers, merge queues — all out of scope for this plan).

**Stack decisions (already made, don't re-litigate):** TypeScript, `@vercel/ncc` bundling into a committed `dist/`, npm, Vitest, `@actions/core` + `@actions/github`.

**Design principle carried through every PR:** pure logic (config parsing, the decision engine) is built and fully unit-tested *before* any GitHub API adapter code, so the hardest-to-get-right part (the decision matrix) never depends on mocking the network to test. This mirrors the unit/integration split in `docs/Internals/testing.md`.

## PR 1 — Project scaffolding

- `package.json` (TypeScript, `@actions/core`, `@actions/github`, `@vercel/ncc`, `vitest`, `typescript`, `eslint` + `@typescript-eslint`), `tsconfig.json`, lint config, `.gitignore` (`node_modules`, but **not** `dist` — `dist` is committed since composite actions have no install step).
- `action.yml` at repo root: composite action with inputs `bypass-labels` and `frozen-teams` (both required, default `""`), a step calling `DataDog/dd-octo-sts-action@<sha>` (placeholder SHA — pinned for real in PR 7), then a `node20` step running `dist/index.js`. `dist/index.js` can be a stub (`core.info('not yet implemented')`) for this PR.
- `.github/workflows/ci.yml` for this repo itself: install, lint, typecheck, `vitest run`, and `ncc build` on every PR/push.
- No production logic yet — this PR exists so `npm test` / `npm run build` are meaningful scaffolding for every PR after it.

## PR 2 — Config parsing and validation

Source: README.md "Configuration fields" + "Team names must be GitHub team slugs..." paragraph; `docs/Internals/README.md` Failure policy ("Missing or invalid configuration" fails closed).

- `src/config.ts`: parse the two newline-delimited inputs into `{ bypassLabels: string[], frozenTeams: string[] }`.
  - Split on newlines, trim, drop blank lines.
  - Validate each `frozen-teams` entry matches `@org/slug`; reject display names, a bare slug with no org, or an org that doesn't match the repository's own org (org is available without an API call — it's the repo context).
  - Empty `frozen-teams` is valid and means "disabled" — this is a *distinct* case from "missing/malformed", which must fail closed.
  - Return a typed `ConfigError` (not a generic thrown `Error`) so PR 6 can map it to the fail-closed path uniformly alongside the other error types from PR 4/5.
- `test/config.test.ts`: valid lists, empty `frozen-teams`, missing required input, malformed slug, wrong-org slug, blank-line handling, duplicate entries.

## PR 3 — Decision engine (pure, no network)

Source: `docs/Internals/README.md` "Decision algorithm" section (canonical order: empty frozen-teams → pass; bypass-label present → pass; else resolve participants/teams and check intersection).

- `src/decision.ts`, pure function:
  `decide({ frozenTeams, bypassLabels, prLabels, participants, teamMembership }) -> { outcome: 'pass' | 'fail', matchedTeams: string[] }`
  - `frozenTeams` empty → pass.
  - Any `bypassLabels` entry present in `prLabels` (case-insensitive) → pass, **without needing `teamMembership` at all** — this mirrors "the label check runs before team-membership resolution" and lets PR 6 skip fetching team membership entirely when it short-circuits here.
  - Otherwise intersect `participants` against `teamMembership` (team → member-login set): no intersection → pass; intersection → fail, returning the matched team names (for the job summary — never the matched user list, per the "avoid exposing unnecessary org membership information" rule in `docs/Internals/README.md`).
- `test/decision.test.ts`: cover every row of README's "Expected behavior" table, plus any-match across multiple frozen teams, any-match across multiple bypass labels, and case-insensitive label matching.

## PR 4 — Participant identity resolution (GitHub API adapter)

Source: `docs/Internals/participant-identity-resolution.md`.

- `src/github/participants.ts`: given an Octokit client + PR number, return the deduplicated set of GitHub logins:
  - `pull_request.user.login`.
  - Paginate `GET /repos/{owner}/{repo}/pulls/{pull_number}/commits` (use Octokit's `paginate` — pagination must be fully consumed), collect `commit.author.login` / `commit.committer.login` only where GitHub has linked an account.
  - Track unmapped author/committer identities separately for warning logs — never fail or block on them, never treat them as participants.
  - Let unexpected/rate-limited responses throw — PR 6 catches and fails closed.
- `test/github/participants.test.ts` (mocked Octokit transport or `nock`): author-only PR, multi-commit PR, mapped vs. unmapped identities, duplicate logins across commits, multi-page pagination.

## PR 5 — Team membership resolution (GitHub API adapter)

Source: `docs/Internals/README.md` "Team membership resolution" section.

- `src/github/teams.ts`: given the Octo-STS-issued Octokit client + org + frozen team slugs, return `Map<teamSlug, Set<login>>`:
  - One paginated `GET /orgs/{org}/teams/{team_slug}/members` call **per team** (not per-participant — this is the documented API-cost rationale: teams are few, participants can be many).
  - An unknown/inaccessible team (404/403) is a distinct, typed `TeamResolutionError` — not swallowed, becomes a fail-closed error in PR 6.
  - Fully consume pagination; any pagination/rate-limit failure also becomes a `TeamResolutionError`.
- `test/github/teams.test.ts`: single team, multiple teams, pagination, unknown team (404), inaccessible team (403), rate-limited response.

## PR 6 — Action entrypoint: wiring, reporting, fail-closed policy

Source: `docs/Internals/README.md` "Check reporting" + "Failure policy"; README's example failure summary format.

- `src/main.ts`, the real entrypoint:
  1. Read inputs via `@actions/core`, parse with `config.ts` — malformed config fails closed immediately with a clear message.
  2. `frozenTeams` empty → pass immediately, no API calls.
  3. Any `bypassLabels` entry already on the PR (from the webhook payload's `pull_request.labels`) → pass immediately, skipping both the participants and team-membership calls entirely.
  4. Otherwise call `participants.ts` (PR 4) and `teams.ts` (PR 5), then `decision.ts` (PR 3).
  5. Pass → `core.info`, exit 0.
  6. Fail → build the job summary via `core.summary`: configured failure message, matched frozen teams (team names only, never member lists), the configured `bypass-labels`, remediation text matching README's example format — then `core.setFailed('Your team is frozen')`.
  7. Any thrown error from steps 1/4/5 (API auth failure, `TeamResolutionError`, unexpected response shape) is caught at the top level and treated as a fail-closed result with a distinct summary message ("policy could not be evaluated safely"), per the Failure policy list.
- Wire `action.yml`'s node step to the real `dist/index.js` output.
- `test/main.test.ts`, end-to-end through `main()` with mocked Octokit: the label-short-circuit path, the pass path, the fail path (assert summary content), and each fail-closed error path.

## PR 7 — Bundling pipeline and policy-file protection

- `npm run build` (`ncc build src/main.ts -o dist`) as a committed, CI-checked step: CI runs the build and fails if `git diff --exit-code dist/` is non-empty, so `dist/` can never drift from `src/`.
- Pin `DataDog/dd-octo-sts-action` in `action.yml` to a real reviewed commit SHA (placeholder since PR 1).
- Update `.github/CODEOWNERS` to explicitly cover `action.yml`, `src/`, and `dist/` — confirm the current blanket `*` owner is sufficient, or add explicit paths, per README's "Protecting the policy files" guidance applied to this action's own repo.

## Manual end-to-end verification (after PR 7, not a PR)

No GitHub org/team fixtures exist in this environment, so this step happens against a real repo:

1. `npm test` and `npm run build` (no `dist/` diff) are the automated gate for every PR above — this should already be green before this step.
2. Create a throwaway consuming workflow (per README's "Workflow configuration" example) in a real, non-production repo you control, `uses:` pointed at this branch's commit SHA, with a real Octo STS trust policy granting `Members: read`.
3. Manually drive the Expected Behavior matrix: open a PR with a frozen-team participant and no label (expect fail) → add the bypass label (expect pass on `labeled` re-run) → remove it (expect fail on `unlabeled` re-run) → push a new commit from a frozen author (expect fail on `synchronize`).
4. Confirm the job summary matches the documented format and never leaks a team member list.
5. Only after this passes, follow README's rollout steps (ruleset in **Evaluate** mode first, then **Active**).
