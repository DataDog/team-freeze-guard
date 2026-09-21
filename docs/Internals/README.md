# Implementation details and design choices

## Team membership resolution

For each configured frozen team, the separate "Resolve frozen team membership" action step (`dist/resolve-team-membership/index.js`) lists active team members using the organization-scoped Octo STS token and writes the result to a JSON file. The evaluator (`dist/index.js`) reads that file rather than calling the Teams API itself, and treats the file's keys as the authoritative frozen-teams list — it no longer parses the raw `frozen-teams` input. It intersects team membership with the pull request participant set.

`action.yml` can skip resolving membership itself by restoring that same JSON file from the GitHub Actions cache instead (see `docs/Internals/architecture.md`'s "Team-membership caching" section). This is opportunistic, not required: a cache miss falls back to resolving membership exactly as described above, so the rest of this section's behavior holds either way.

Listing each team's members is preferred over querying every participant against every team:

- The number of frozen teams is expected to be small.
- It avoids `participants × teams` API requests on pull requests with many commits.
- It makes it straightforward to report which frozen teams matched.

All paginated results must be consumed. Nested-team membership follows the behavior of GitHub's team-members API.

Unknown teams, inaccessible teams, incomplete pagination, rate limiting, and unexpected API responses are policy-evaluation errors and therefore fail the check.

## Decision algorithm

The action, across `action.yml` and the two Node programs it invokes — `dist/resolve-team-membership/index.js` (team membership resolution) then `dist/index.js` (the evaluator) — applies the following algorithm:

```text
if frozen-teams is empty:
    pass                                    # action.yml, before either Node program ever runs

if this run is push/workflow_dispatch/schedule on a non-default-branch ref:
    pass                                    # action.yml, before either Node program ever runs
                                             # (a cache saved here could never be restored anyway)

if a cached membership file matches this frozen-teams value:   # action.yml, restore step
    skip straight to "load and validate trusted repository configuration" below,
    unless this run is push/workflow_dispatch/schedule (those always resolve fresh)

resolve the active members of every frozen team            # dist/resolve-team-membership/index.js,
                                                             # skipped on a cache hit, except as above
write the resolved membership to a JSON file

if this run is push/workflow_dispatch/schedule:             # action.yml, save step
    save the JSON file to the Actions cache, then stop — there is no pull request to evaluate

load and validate trusted repository configuration          # dist/index.js, from here on

if every configured bypass mechanism is satisfied
(bypass-labels: any entry present; bypass-title-pattern: PR title matches):
    pass

check whether the PR author belongs to any team in the JSON file's frozen teams

if the PR author does not belong to a frozen team:
    pass

fail with "Your team is frozen"
```

Team-membership resolution now runs in its own step, unconditionally, before the evaluator even starts — see `docs/Internals/architecture.md`'s Architecture section. This means the bypass check (`shouldBypass` in `src/decision.ts`) can no longer save the team-membership API calls the way it once could when both lived in the same process: those calls always happen when `frozen-teams` is non-empty, bypass or not.

The `frozen-teams`-empty short circuit is stricter than "skip participant resolution": it must skip **every** external call, including the Octo STS token exchange and the team-membership API calls, not just the evaluator's own calls. `action.yml` enforces this directly, before either Node program is ever invoked, via a `shell: python` step, "Early checks," that produces a `skip` output the Octo STS step and both `dist/resolve-team-membership/index.js` and `dist/index.js`'s steps are conditioned on. The same `skip` output, and thus the same "no external call" guarantee, also covers a `push`/`workflow_dispatch`/`schedule` run on a ref other than the default branch — see `docs/Internals/architecture.md`'s "Team-membership caching" section for why such a run's cache save could never be restored anyway.

`frozen-teams` is empty once blank lines are stripped. `inputs.frozen-teams != ''` alone isn't enough here, since a whitespace-only or newline-only value (e.g. `"\n \n"`) is also "no frozen teams" as far as `src/config.ts`'s own parsing would treat it, but isn't the literal `''` string — this step normalizes the same way `splitLines` in `src/config.ts` does before comparing. The `"not set"` sentinel default is deliberately **not** treated as empty here, so an omitted input still reaches `dist/resolve-team-membership/index.js` and fails closed there; because a failed step stops the job by default, `dist/index.js` never runs in that case either.

This means an empty (or whitespace-only) `frozen-teams` configuration makes zero external calls — no Octo STS exchange, no team-membership resolution, no evaluator invocation at all — while a satisfied bypass on an otherwise-frozen pull request still costs the Octo STS exchange and the team-membership resolution (both needed to fail closed on a malformed config before the evaluator's own `shouldBypass` check ever runs) before that check short-circuits participant resolution.

The policy uses **any-match semantics** within `bypass-labels`: any one of the configured `bypass-labels` is enough to satisfy that mechanism. Across mechanisms, semantics are **all-match**: when both `bypass-labels` and `bypass-title-pattern` are configured, both must be satisfied — a bypass label alone, or a matching title alone, does not pass. A mechanism left unconfigured (empty) is treated as satisfied, so a single configured mechanism can bypass on its own. Only the pull request author is checked against frozen-team membership; it does not prevent a frozen engineer from asking a teammate to open the pull request or commit on their behalf — see the "Only the pull request author is checked" limitation in `docs/limitations.md`.

## Check reporting

The action communicates through the normal GitHub Actions job result:

- Success when the merge is permitted by the team-freeze policy.
- Failure when a bypass label is required or the policy cannot be evaluated safely.

On a policy denial, the job summary includes:

- The configured failure message.
- The matching frozen teams.
- The configured `bypass-labels` and `bypass-title-pattern`.
- A clear remediation instruction.

The action should avoid exposing unnecessary organization membership information. Reporting matching teams is sufficient; listing every matching user is useful for debug logs but should not be included in the default user-facing summary.

The optional team-membership cache (see `docs/Internals/architecture.md`'s "Team-membership caching" section) is a deliberate exception to this: the cached file contains every frozen team's full member list, and any workflow able to restore a GitHub Actions cache entry for the repository — including a `pull_request`-triggered workflow added by a fork, which only needs a read-only cache token — can read it, using a cache key that's derivable from the public `frozen-teams` workflow input. See `docs/limitations.md`'s "Cached team membership is effectively public" entry before enabling the cache.

## Failure policy

The action fails closed for:

- Missing or invalid configuration.
- Octo STS token exchange failures.
- GitHub API authentication or authorization failures.
- Unknown or inaccessible configured teams.
- Pagination or rate-limit failures.
- Unexpected or incomplete API responses.

A temporary dependency failure may therefore block merging. This is intentional: inability to determine whether a participant is frozen must not silently authorize the merge. Operational bypasses should be explicit, limited, and auditable through the ruleset bypass process.

## Event coverage

The workflow reacts to:

| Event | Reason |
| --- | --- |
| `opened` | Initial evaluation. |
| `reopened` | Re-evaluate a reopened pull request. |
| `synchronize` | Re-evaluate after new commits are pushed. The PR author does not change on this event, so this mostly guards against a stale prior result rather than a new participant. |
| `labeled` | Permit the pull request when a configured bypass label is added. |
| `unlabeled` | Block the pull request if the last matching bypass label is removed. |
| `ready_for_review` | Evaluate a draft when it becomes reviewable. |
| `edited` | Re-evaluate when the pull request title changes, since a `bypass-title-pattern` match depends on it. |

Pull request description, assignee, and review changes do not affect the policy and do not require evaluation.

Repository configuration and GitHub team membership changes do not generate these events. They require the explicit reconciliation process described in the user guide.

The optional cache warm-up workflow (see the README's "Caching team membership" section) is triggered separately, by `push`, `schedule`, and `workflow_dispatch` — none of which carry a pull request, so `action.yml` skips policy evaluation for them and only resolves and caches team membership (see the Decision algorithm above).

## Configuration and workflow ownership

The action implementation is centrally maintained, but each repository owns:

- Its `bypass-labels` and `bypass-title-pattern`.
- Its list of frozen teams.

The CI-owning team should own reviews for the workflow files. Incident automation may update the frozen-team list, but those mutations should remain attributable and auditable through Git history.
