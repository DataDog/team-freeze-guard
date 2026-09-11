# Implementation details and design choices

## Team membership resolution

The trusted refresh operation uses the organization-scoped Octo STS token to cache active members for every configured frozen team. The pull request evaluator reads that snapshot and checks the author.

Listing each team's members is preferred over querying every participant against every team:

- The number of frozen teams is expected to be small.
- GraphQL aliases normally fetch all configured teams in one request.
- It makes it straightforward to report which frozen teams matched.

Each team requests up to 100 members. Additional GraphQL requests are made only for teams that require another page. Nested-team membership follows GitHub's GraphQL team-membership behavior.

Unknown teams, inaccessible teams, incomplete pagination, rate limiting, and unexpected API responses are policy-evaluation errors and therefore fail the check.

## Decision algorithm

The action, across `action.yml` and the evaluator (`dist/index.js`) it invokes, applies the following algorithm:

```text
if frozen-teams is empty:
    pass

load and validate trusted repository configuration

if every configured bypass mechanism is satisfied
(bypass-labels: any entry present; bypass-title-pattern: PR title matches):
    pass

load and validate the cached team-membership snapshot
check the pull request author against every frozen team

if the author belongs to no frozen team:
    pass

fail with "Your team is frozen"
```

The bypass check runs before reading the membership snapshot. Pull request evaluation makes no GitHub API or Octo STS calls.

The `frozen-teams`-empty short circuit skips cache access, token exchange, and the evaluator. `action.yml` enforces it before either operation.

`frozen-teams` is empty once blank lines are stripped. `inputs.frozen-teams != ''` alone isn't enough here, since a whitespace-only or newline-only value (e.g. `"\n \n"`) is also "no frozen teams" as far as `src/config.ts`'s own parsing would treat it, but isn't the literal `''` string — this step normalizes the same way `splitLines` in `src/config.ts` does before comparing. The `"not set"` sentinel default is deliberately **not** treated as empty here, so an omitted input still reaches `dist/index.js` and fails closed.

This means an empty (or whitespace-only) `frozen-teams` configuration makes no external calls.

The policy uses **any-match semantics** within teams and `bypass-labels`: author membership in one frozen team is enough to require a bypass, and any configured label is enough to satisfy the label mechanism. Across mechanisms, semantics are **all-match**: when both `bypass-labels` and `bypass-title-pattern` are configured, both must be satisfied. Accountability is intentionally based only on the pull request author.

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

## Failure policy

The action fails closed for:

- Missing or invalid configuration.
- Missing, stale, or inconsistent membership snapshots.
- Refresh-time Octo STS or GitHub API failures.
- Unknown or inaccessible configured teams.
- Pagination or rate-limit failures.
- Unexpected or incomplete API responses.

A temporary dependency failure may therefore block merging. This is intentional: inability to determine whether the author is frozen must not silently authorize the merge. Operational bypasses should be explicit, limited, and auditable through the ruleset bypass process.

## Event coverage

The workflow reacts to:

| Event | Reason |
| --- | --- |
| `opened` | Initial evaluation. |
| `reopened` | Re-evaluate a reopened pull request. |
| `synchronize` | Report the result for the pull request's new head SHA. |
| `labeled` | Permit the pull request when a configured bypass label is added. |
| `unlabeled` | Block the pull request if the last matching bypass label is removed. |
| `ready_for_review` | Evaluate a draft when it becomes reviewable. |
| `edited` | Re-evaluate when the pull request title changes, since a `bypass-title-pattern` match depends on it. |

Pull request description, assignee, and review changes do not affect the policy and do not require evaluation.

Repository configuration and GitHub team membership changes do not generate these events. They require the explicit reconciliation process described in the user guide.

## Configuration and workflow ownership

The action implementation is centrally maintained, but each repository owns:

- Its `bypass-labels` and `bypass-title-pattern`.
- Its list of frozen teams.

The CI-owning team should own reviews for the workflow files. Incident automation may update the frozen-team list, but those mutations should remain attributable and auditable through Git history.
