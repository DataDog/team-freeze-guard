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

The evaluator applies the following algorithm:

```text
load and validate trusted repository configuration

if frozen_teams is empty:
    pass

collect PR author and GitHub-linked commit authors/committers
resolve the active members of every frozen team
find intersections between participants and frozen teams

if there are no intersections:
    pass

if required_label is present:
    pass

fail with "Your team is frozen"
```

The policy uses **any-match semantics**: one frozen participant is enough to require the label. This prevents a frozen engineer from bypassing the policy by opening a pull request through another author or contributing commits to an existing pull request.

## Check reporting

The action communicates through the normal GitHub Actions job result:

- Success when the merge is permitted by the team-freeze policy.
- Failure when a label is required or the policy cannot be evaluated safely.

On a policy denial, the job summary includes:

- The configured failure message.
- The matching frozen teams.
- The required label.
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
| `labeled` | Permit the pull request when the required label is added. |
| `unlabeled` | Block the pull request if the required label is removed. |
| `ready_for_review` | Evaluate a draft when it becomes reviewable. |

Pull request title, description, assignee, and review changes do not affect the policy and do not require evaluation.

Repository configuration and GitHub team membership changes do not generate these events. They require the explicit reconciliation process described in the user guide.

## Configuration and workflow ownership

The action implementation is centrally maintained, but each repository owns:

- Its exception label.
- Its list of frozen teams.

The CI-owning team should own reviews for the workflow files. Incident automation may update the frozen-team list, but those mutations should remain attributable and auditable through Git history.
