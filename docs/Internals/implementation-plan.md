# Implementation plan

Working plan for building the `team-freeze-guard` action from the design docs. This file is meant to be read cold by whoever (human or agent) picks up the next PR — it should always reflect current status, not just the original intent.

**How to use this file:** before starting a PR, read its section below plus the specific design-doc sections it links to — you don't need to re-read every doc from scratch. After a PR merges, check its box and note any deviation from the plan directly under that PR's heading (don't silently drift — if reality differs from the plan, write down why, since that's exactly the kind of thing a future reader can't infer from the diff alone).

## Status

- [x] PR 1 — Project scaffolding
- [x] PR 2 — Config parsing and validation
- [x] PR 3 — Decision engine (pure, no network)
- [x] PR 4 — Participant identity resolution (GitHub API adapter)
- [x] PR 5 — Team membership resolution (GitHub API adapter)
- [x] PR 6 — Action entrypoint: wiring, reporting, fail-closed policy
- [x] PR 7 — Bundling pipeline and policy-file protection
- [ ] Manual end-to-end verification (not a PR — see bottom)

## Context

Before this plan, the repo contained only design docs — no code. The docs are the spec, not just background reading:

- `README.md` — public contract: config fields (`bypass-labels`, `frozen-teams`), workflow example, permissions, expected-behavior matrix, ruleset rollout.
- `docs/Internals/README.md` — team-membership resolution strategy, the canonical decision algorithm, check reporting rules, fail-closed error list, event coverage table.
- `docs/Internals/architecture.md` — composite-action structure, trusted-execution rules for `pull_request_target`, why config comes from workflow `with:` inputs (not a checked-out file).
- `docs/Internals/participant-identity-resolution.md` — exact rule for building the participant set (PR author + GitHub-linked commit committer logins only, unmapped identities are warnings not participants).
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

**Status: implemented, not yet reviewed.** Deviations from the plan:
- Same environment constraint as PR 1: no Node.js/npm available in the sandbox that wrote this PR, so `src/config.ts` and `test/config.test.ts` have never been installed, linted, type-checked, or run locally — CI is still the first real execution of this code.
- The PR 1 carried-forward housekeeping (`npm install` to generate `package-lock.json`, then switching `ci.yml`'s `npm install` to `npm ci`) is **still not done**, for the same reason. This remains an open follow-up for whoever has a working Node/npm environment.

## PR 3 — Decision engine (pure, no network)

Source: `docs/Internals/README.md` "Decision algorithm" section (canonical order: empty frozen-teams → pass; bypass-label present → pass; else resolve participants/teams and check intersection).

- `src/decision.ts`, pure function:
  `decide({ frozenTeams, bypassLabels, prLabels, participants, teamMembership }) -> { outcome: 'pass' | 'fail', matchedTeams: string[] }`
  - `frozenTeams` empty → pass.
  - Any `bypassLabels` entry present in `prLabels` (case-sensitive, exact match) → pass, **without needing `teamMembership` at all** — this mirrors "the label check runs before team-membership resolution" and lets PR 6 skip fetching team membership entirely when it short-circuits here.
  - Otherwise intersect `participants` against `teamMembership` (team → member-login set): no intersection → pass; intersection → fail, returning the matched team names (for the job summary — never the matched user list, per the "avoid exposing unnecessary org membership information" rule in `docs/Internals/README.md`).
- `test/decision.test.ts`: cover every row of README's "Expected behavior" table, plus any-match across multiple frozen teams, any-match across multiple bypass labels, and case-sensitive label matching.

**Deviations from the plan:**
- `src/decision.ts` and `test/decision.test.ts` were initially written without a local Node/npm environment; Node was later installed and `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` were all run and verified passing locally.
- The PR 1 carried-forward housekeeping is now **done**: `npm install` was run to generate and commit `package-lock.json`, `ci.yml`'s install step switched from `npm install` to `npm ci`, and `cache: npm` re-enabled on the `setup-node` step.

## PR 4 — Participant identity resolution (GitHub API adapter)

Source: `docs/Internals/participant-identity-resolution.md`.

- `src/github/participants.ts`: given an Octokit client + the pull request's head SHA, return the deduplicated set of GitHub logins:
  - `pull_request.user.login`.
  - A single `GET /repos/{owner}/{repo}/commits/{sha}` call against `pull_request.head.sha` — not a paginated list of every commit — collecting `commit.committer.login` only where GitHub has linked an account. Commit *authorship* is intentionally not checked, and only the head commit is checked, not the full commit history — see `docs/limitations.md` for both tradeoffs.
  - Track an unmapped committer identity separately for warning logs — never fail or block on it, never treat it as a participant.
  - Let unexpected/rate-limited responses throw — PR 6 catches and fails closed.
- `test/github/participants.test.ts` (mocked Octokit transport or `nock`): PR author alone, author + mapped head committer, deduplication when they're the same login, unmapped head committer identity, asserting only the head commit is fetched (not a commit list).

**Status: implemented, not yet reviewed.** Deviations from the plan:
- The plan originally called for paginating every commit on the pull request and collecting both author and committer logins across all of them. This was narrowed twice during review: first to committer-only (dropping commit-author resolution), then to the head commit only (dropping full commit-history pagination) — a single `GET .../commits/{sha}` call replaces `octokit.paginate(...pulls.listCommits...)` entirely. Both tradeoffs are documented in `docs/limitations.md`.
- Uses a hand-written fake Octokit object (matching the shape `{ rest: { repos: { getCommit } } }`) rather than `nock`, since no HTTP transport needs mocking — `getCommit` is the only surface `resolveParticipants` touches.
- Verified locally: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass.

## PR 5 — Team membership resolution (GitHub API adapter)

Source: `docs/Internals/README.md` "Team membership resolution" section.

- `src/github/teams.ts`: given the Octo-STS-issued Octokit client + org + frozen team slugs, return `Map<teamSlug, Set<login>>`:
  - One paginated `GET /orgs/{org}/teams/{team_slug}/members` call **per team** (not per-participant — this is the documented API-cost rationale: teams are few, participants can be many).
  - An unknown/inaccessible team (404/403) is a distinct, typed `TeamResolutionError` — not swallowed, becomes a fail-closed error in PR 6.
  - Fully consume pagination; any pagination/rate-limit failure also becomes a `TeamResolutionError`.
- `test/github/teams.test.ts`: single team, multiple teams, pagination, unknown team (404), inaccessible team (403), rate-limited response.

**Status: implemented and reviewed (merged as GitHub PR #7).** Deviations from the plan:
- `TeamResolutionError` is thrown (not returned as a value like `ConfigError`), matching `participants.ts`'s "let unexpected responses throw, PR 6 catches" convention rather than `config.ts`'s returned-union convention.
- Uses a hand-written fake Octokit exposing `rest.teams.listMembersInOrg` plus a minimal `paginate` implementation (stops when a page returns fewer than `per_page` items), rather than `nock`, matching the approach used for `participants.test.ts`.
- `resolveTeamMembership()` takes `teamHandles: string[]` in the config's `@org/team-slug` form (not a bare `team_slug`), since that's the form `frozenTeams` entries and `decide()`'s comparisons use elsewhere in the codebase. Internally it extracts the bare slug for the GitHub API request (`team_slug` must not include the `@org/` prefix), while the returned `Map`'s keys stay as the full handle, so callers never need to reconcile two different team-name representations. Also splits 404 ("unknown team") from 403 ("inaccessible team") error messages, since a permission failure is a different operational problem than a nonexistent team.
- Follow-up review round (Copilot) tightened `extractTeamSlug()` to fully validate the `@org/team-slug` pattern (rejecting a missing `@` or an extra path segment) and to check the handle's embedded org against the resolution `org`, rather than only checking for the presence of a `/`.
- Verified locally: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` all pass.

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

**Status: implemented, not yet reviewed.** Deviations from the plan:
- `src/main.ts` splits into a testable `evaluate(input: EvaluateInput)` (all dependencies passed explicitly: raw config strings, repo owner/name, a `PullRequestContext`, pre-built `octokit`/`orgOctokit` clients, and a `Reporter` abstraction over `core.info`/`core.warning`/`core.setFailed`/`core.summary`) and a thin `run()` composition root that wires the real `@actions/core`/`@actions/github` dependencies. This avoids `vi.mock()` module mocking in `test/main.test.ts`, consistent with the hand-written-fake-Octokit approach used in `participants.test.ts`/`teams.test.ts`. `run()` only executes when the module is invoked directly (`require.main === module`), so importing `evaluate`/`run` from tests doesn't trigger the real entrypoint (which would otherwise throw immediately outside a real Action run, e.g. missing `GITHUB_REPOSITORY`).
- Discovered and fixed a **latent production bug in `action.yml` dating back to PR 1**: the composite step set `INPUT_BYPASS_LABELS`/`INPUT_FROZEN_TEAMS` (underscore) as env vars, but `@actions/core`'s `getInput()` only replaces *spaces* (not dashes) before uppercasing an input name, so it actually looks up `INPUT_BYPASS-LABELS`/`INPUT_FROZEN-TEAMS` (dash preserved). This never surfaced before because no code called `core.getInput()` for real until this PR. Fixed by renaming the env vars to keep the dash, with an explanatory comment.
- **Downgraded `@actions/core` from `^3.0.1` to `^2.0.3` and `@actions/github` from `^9.1.1` to `^8.0.1`** (both bumped to the ESM-only versions in the earlier dependency-security-fix PR, whose stub `src/main.ts` never actually imported them, so the incompatibility was never exercised). `@actions/core@3.0.0`/`@actions/github@9.0.0` switched their package `"type"` to `"module"` with an ESM-only `exports` map, which `@vercel/ncc@0.38.4` cannot bundle into the committed CJS `dist/index.js` — `npm run build` failed with a "Package path . is not exported" resolution error as soon as `main.ts` (this PR) imported them for real. `@actions/core@2.0.3`/`@actions/github@8.0.1` are the last CJS-compatible releases and independently verified to have **0 `npm audit` vulnerabilities**, so this downgrade keeps the earlier security fix intact while restoring a working build.
- Extracted `hasBypassLabel(bypassLabels, prLabels)` out of `decision.ts`'s `decide()` as a shared exported helper, so `main.ts` can reuse the exact same case-sensitive matching logic to short-circuit before calling `participants.ts`/`teams.ts`, rather than duplicating the check.
- `buildFailureSummary()` matches the README's documented failure-summary format (message, matched team names — never member lists — and the configured bypass labels as remediation).
- Verified locally: `npm run lint`, `npm run typecheck`, `npm test` (47 tests passing), and `npm run build` all pass.

## PR 7 — Bundling pipeline and policy-file protection

- `npm run build` (`ncc build src/main.ts -o dist`) as a committed, CI-checked step: CI runs the build and fails if `git diff --exit-code dist/` is non-empty, so `dist/` can never drift from `src/`.
- Pin `DataDog/dd-octo-sts-action` in `action.yml` to a real reviewed commit SHA (placeholder since PR 1).
- Update `.github/CODEOWNERS` to explicitly cover `action.yml`, `src/`, and `dist/` — confirm the current blanket `*` owner is sufficient, or add explicit paths, per README's "Protecting the policy files" guidance applied to this action's own repo.

**Status: implemented, not yet reviewed.** Deviations from the plan:
- `.github/workflows/ci.yml`'s build step now checks `git status --porcelain -- dist/` after `npm run build` and fails the job with an annotation if it's non-empty (printing `git diff`/`git status` output first for debugging), rather than only running the build without asserting on drift. `git status --porcelain` is used instead of `git diff --exit-code` because the latter only catches changes to already-tracked paths — it would miss a new *untracked* file the bundler starts emitting under `dist/`.
- `DataDog/dd-octo-sts-action` is pinned to `96a25462dbcb10ebf0bfd6e2ccc917d2ab235b9a` (tag `v1.0.4`, the latest release at the time of this PR, verified via the GitHub API). The `scope: REPLACE_WITH_ORG/REPLACE_WITH_POLICY` value is **intentionally still a placeholder** — filling it in requires knowing the real trust-policy name published in DataDog's canonical Octo STS policy location (an org-specific artifact this repo has no way to look up or verify), and guessing it risks silently pointing at the wrong or a nonexistent policy. This remains an open follow-up for whoever publishes that trust policy; the TODO comment above the step was updated to reflect that only the SHA is resolved.
  - **Follow-up (resolved after PR 7):** the placeholder was filled in with `scope: DataDog` / `policy: team-freeze-guard.read-org-members`, backed by a real trust policy published in `DataDog/.github` ([#457](https://github.com/DataDog/.github/pull/457)), and the `dd-octo-sts-action` pin was bumped to `v1.0.5`. See `docs/Internals/octo-sts.md` for the published policy content and the single-repo-subject rationale.
- `.github/CODEOWNERS` keeps the existing blanket `* @DataDog/apm-reliability-and-performance` rule (no separate "CI-owning team" exists to delegate to) and adds explicit `/action.yml`, `/src/`, `/dist/` entries pointing at the same team — redundant given the blanket rule today, but makes the protection of these specific paths an explicit, intentional statement rather than an incidental side effect of the catch-all.
- Verified locally: `npm run lint`, `npm run typecheck`, `npm test` (53 tests passing), `npm run build`, and a manual `git status --porcelain -- dist/` all pass with no drift.

## Manual end-to-end verification (after PR 7, not a PR)

No GitHub org/team fixtures exist in this environment, so this step happens against a real repo:

1. `npm test` and `npm run build` (no `dist/` diff) are the automated gate for every PR above — this should already be green before this step.
2. Create a throwaway consuming workflow (per README's "Workflow configuration" example) in a real, non-production repo you control, `uses:` pointed at this branch's commit SHA, with a real Octo STS trust policy granting `Members: read`.
3. Manually drive the Expected Behavior matrix: open a PR with a frozen-team participant and no label (expect fail) → add the bypass label (expect pass on `labeled` re-run) → remove it (expect fail on `unlabeled` re-run) → push a new commit from a frozen author (expect fail on `synchronize`).
4. Confirm the job summary matches the documented format and never leaks a team member list.
5. Only after this passes, follow README's rollout steps (ruleset in **Evaluate** mode first, then **Active**).

## PR 8 — Split team-membership resolution into its own step

Prep work for a follow-up PR that will cache frozen-team membership in the GitHub Actions cache: split the single "Evaluate team freeze policy" step into two, so the cacheable part (one API call per frozen team, needing the Octo STS `ORG_TOKEN`) is isolated from the part that can't be cached (resolving this PR's own participants and deciding pass/fail).

- New `src/resolveTeamMembership.ts` entrypoint: parses only `frozen-teams` (via the new `parseFrozenTeamsInput()` in `src/config.ts` — it has no notion of bypass labels), calls `resolveTeamMembership()` from `src/github/teams.ts`, and writes the result as a `team-membership` step output (`Map<string, Set<string>>` serialized to `JSON.stringify(Object.fromEntries(...))`, i.e. `{ "@org/team-a": ["alice", "bob"] }`).
- `src/main.ts` no longer resolves team membership itself: `EvaluateInput.orgOctokit` is replaced by a plain `teamMembership: Map<string, Set<string>>`, deserialized from the new `TEAM_MEMBERSHIP` env var (the prior step's output) rather than fetched over the network. The bypass-label short-circuit and its early-checks skip condition are untouched — deliberately, since a later PR will add a second, independent condition (an approval from a given team) alongside the bypass label, and that logic should only ever live in one place.
- Shared reporting/fail-closed helpers (`Reporter`, `buildReporter`, `reportFailClosed`, `safeWriteSummary`, `formatError`, `getRequiredEnv`, `FROZEN_MESSAGE`, `FAIL_CLOSED_SUMMARY`) extracted into `src/reporting.ts` so both entrypoints share one implementation rather than diverging.
- `action.yml` gains a "Resolve frozen team membership" step between the Octo STS exchange and "Evaluate team freeze policy", running a second bundle at `dist/resolve-team-membership/index.js`. `package.json`'s `build` script now runs `ncc` twice (`dist/` and `dist/resolve-team-membership/`).

**Status: implemented and reviewed (merged as GitHub PR #12).** Deviations from the plan:
- The new step still runs (and pays for) the per-team API calls even when a bypass label is already present on the PR — this matches, rather than optimizes, today's `action.yml`-level behavior (the Octo STS exchange itself is already unconditional on the bypass label; only `evaluate()`'s in-process short-circuit currently skips the team-API calls). An earlier version of this PR moved that skip up into the early-checks step, but the bypass/label logic is intentionally kept in exactly one place (`decide()`/`hasBypassLabel()` in `src/decision.ts`) ahead of an upcoming PR that adds a second, independent bypass condition (a team approval) alongside it.
- No caching is added in this PR, per the request — the new step still calls the GitHub API on every run. That's PR 9.
- Verified locally: `npm run lint`, `npm run typecheck`, `npm test` (56 tests passing), and `npm run build` (no `dist/` diff) all pass.
- Review also caught: a synchronous throw in `resolveTeamMembership.ts`'s input construction (e.g. a missing `ORG_TOKEN`) could bypass the fail-closed reporting path, and `evaluate()` didn't validate that the resolved `teamMembership` map actually covered every configured frozen team. Both fixed before merge (see PR 9's note on the latter — it's what motivated the file-based membership handoff).

## PR 9 — Cache resolved team membership across pipeline runs

Caches the "Resolve frozen team membership" step's result (one API call per frozen team) in the GitHub Actions cache, so most runs skip both the Octo STS OIDC exchange and the team-membership API calls entirely.

- `action.yml` gains two new steps between "Exchange OIDC identity" and "Resolve frozen team membership":
  - "Compute team-membership cache key": a cache key of `team-freeze-guard-membership-<hour-bucket>-<sha256(frozen-teams)>`, where `<hour-bucket>` is `date -u +%Y%m%d%H` — the key changes every hour, so the cache can never serve membership data older than one hour, and the input hash means a config change gets fresh data immediately rather than waiting out the hour.
  - "Restore cached frozen team membership": `actions/cache@v6.1.0`, keyed as above, caching a single JSON file at `${{ runner.temp }}/team-freeze-guard-membership.json`. `actions/cache` auto-saves the path after the job on a miss and no-ops on an exact hit, so no separate save step is needed.
  - "Exchange OIDC identity" and "Resolve frozen team membership" both gain `&& steps.cache.outputs.cache-hit != 'true'` on their `if:`, so a cache hit skips both — no OIDC exchange, no GitHub API calls.
- `src/resolveTeamMembership.ts`: `ResolveTeamMembershipStepInput.setOutput` (a `core.setOutput` call) is replaced by `writeMembershipFile` (a plain `fs.writeFileSync` call to the path in the new `TEAM_MEMBERSHIP_FILE` env var) — the resolved membership now has to land at the exact path `actions/cache` caches, so a step output can no longer be the transport.
- `src/main.ts`: reads the same file directly (`readFileSync(getRequiredEnv('TEAM_MEMBERSHIP_FILE'), 'utf8')`) instead of a `TEAM_MEMBERSHIP` step-output env var — this works identically whether the file came from a fresh resolve or a cache restore, so "Evaluate team freeze policy" needs no `if:` condition on the cache outcome and no separate "load from cache" step.
- Team-membership caches are scoped to the calling repository by the GitHub Actions cache service itself (not by anything in this key), so no explicit repo/org component was added to the key.

**Status: reverted.** Merged, then backed out after live e2e testing:
- End-to-end runs against the real, required `pull_request_target` trigger consistently failed cache writes with `cache write denied: token has no writable scopes`, even with `actions: write` correctly granted. Root cause: GitHub's June 2026 "read-only Actions cache for untrusted triggers" change issues read-only cache tokens for `pull_request`/`pull_request_target`-triggered runs — a platform-level restriction, not something a `permissions:` block, a differently-scoped token, or restructuring the cache action's steps can work around.
- Since `pull_request_target` is a hard requirement for this action's own consuming workflow (needed for `dd-octo-sts-action`'s trust policy — see README), the cache could never actually write from any real deployment, not just from a manual e2e run. The caching feature was dropped entirely rather than kept as a permanently-broken no-op: the two new steps ("Compute team-membership cache key", "Restore cached frozen team membership") were removed from `action.yml`, the `cache-hit` conditions were removed from "Exchange OIDC identity" and "Resolve frozen team membership" (both now run unconditionally again), and the `actions: write` permission and README's "Team membership caching" section were removed.
- With caching gone, PR 8's split into two steps/bundles no longer served its purpose (isolating the cacheable part), so it was undone in the same follow-up: `src/resolveTeamMembership.ts` and the file-based `TEAM_MEMBERSHIP_FILE` handoff were removed, `resolveTeamMembership()` is now called directly from `src/main.ts`'s `evaluateOrThrow()` (using a new `EvaluateInput.orgOctokit`, built from the `ORG_TOKEN` env var) after the bypass-label short-circuit, and `action.yml` is back to two node steps ("Exchange OIDC identity", "Evaluate team freeze policy"). This also restores the bypass-label short-circuit's original benefit of skipping the team-membership API calls entirely, which the PR 8/9 split had lost. `package.json`'s `build` script is back to a single `ncc` invocation.
