# Implementation details and design choices

## Team membership resolution

For each configured frozen team, the evaluator lists active team members using the organization-scoped Octo STS token and intersects that set with the pull request participant set.

Listing each team's members is preferred over querying every participant against every team:

- The number of frozen teams is expected to be small.
- It avoids `participants × teams` API requests on pull requests with many commits.
- It makes it straightforward to report which frozen teams matched.

All paginated results must be consumed. Nested-team membership follows the behavior of GitHub's team-members API.

Unknown teams, inaccessible teams, incomplete pagination, rate limiting, and unexpected API responses are policy-evaluation errors and therefore fail the check.

## Decision algorithm

The action, across `action.yml` and the evaluator (`dist/index.js`) it invokes, applies the following algorithm:

```text
if frozen-teams is empty:
    pass                                    # action.yml, before the evaluator ever runs

load and validate trusted repository configuration

if any bypass-labels entry is present on the pull request:
    pass

collect PR author and the GitHub-linked committer of the current head commit
resolve the active members of every frozen team
find intersections between participants and frozen teams

if there are no intersections:
    pass

fail with "Your team is frozen"
```

The label check runs before team-membership resolution so that a pull request carrying a configured bypass label never triggers the participant and team-membership API calls: fewer API calls means a faster check and less exposure to transient GitHub/Octo STS infrastructure errors, which fail closed per the Failure policy below. This check (`hasBypassLabel` in `src/decision.ts`) stays inside the evaluator rather than moving to `action.yml`, so it still runs after the Octo STS exchange below.

The `frozen-teams`-empty short circuit is stricter than that: it must skip **every** external call, not just the participant and team-membership API calls made from within the evaluator. In particular, the Octo STS token exchange in `action.yml` is itself an external call (one request to Octo STS, distinct from the one-request-per-frozen-team calls made during team-membership resolution) and must not run when `frozen-teams` is empty. `action.yml` enforces this directly, before the evaluator (`dist/index.js`) is ever invoked, via a `shell: python` step, "Early checks," that produces a `skip` output the Octo STS step and the step that invokes `dist/index.js` are both conditioned on:

`frozen-teams` is empty once blank lines are stripped. `inputs.frozen-teams != ''` alone isn't enough here, since a whitespace-only or newline-only value (e.g. `"\n \n"`) is also "no frozen teams" as far as `src/config.ts`'s own parsing would treat it, but isn't the literal `''` string — this step normalizes the same way `splitLines` in `src/config.ts` does before comparing. The `"not set"` sentinel default is deliberately **not** treated as empty here, so an omitted input still reaches `dist/index.js` and fails closed.

This means an empty (or whitespace-only) `frozen-teams` configuration makes zero external calls — no Octo STS exchange, no `dist/index.js` invocation at all — while a bypass label on an otherwise-frozen pull request still costs the Octo STS exchange (needed to fail closed on a malformed config) before `hasBypassLabel` short-circuits the rest of the evaluator.

The policy uses **any-match semantics** on both sides: one frozen participant is enough to require a label, and any one of the configured `bypass-labels` is enough to satisfy it. The participant any-match prevents a frozen engineer from bypassing the policy by opening a pull request through another author or committing directly to an existing pull request. It does not prevent a frozen engineer from asking a teammate to both open the pull request and commit on their behalf — see the "Commit authorship is not checked" limitation in `docs/limitations.md`.

## Check reporting

The action communicates through the normal GitHub Actions job result:

- Success when the merge is permitted by the team-freeze policy.
- Failure when a bypass label is required or the policy cannot be evaluated safely.

On a policy denial, the job summary includes:

- The configured failure message.
- The matching frozen teams.
- The configured `bypass-labels`.
- A clear remediation instruction.

The action should avoid exposing unnecessary organization membership information. Reporting matching teams is sufficient; listing every matching user is useful for debug logs but should not be included in the default user-facing summary.

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
| `synchronize` | Re-evaluate authors and committers after commits change. |
| `labeled` | Permit the pull request when a configured bypass label is added. |
| `unlabeled` | Block the pull request if the last matching bypass label is removed. |
| `ready_for_review` | Evaluate a draft when it becomes reviewable. |

Pull request title, description, assignee, and review changes do not affect the policy and do not require evaluation.

Repository configuration and GitHub team membership changes do not generate these events. They require the explicit reconciliation process described in the user guide.

## Configuration and workflow ownership

The action implementation is centrally maintained, but each repository owns:

- Its `bypass-labels`.
- Its list of frozen teams.

The CI-owning team should own reviews for the workflow files. Incident automation may update the frozen-team list, but those mutations should remain attributable and auditable through Git history.
