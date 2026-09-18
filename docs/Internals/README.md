# Implementation details and design choices

## Team membership resolution

For each configured frozen team, the separate "Resolve frozen team membership" action step (`dist/resolve-team-membership/index.js`) lists active team members using the organization-scoped Octo STS token and writes the result to a JSON file. The evaluator (`dist/index.js`) reads that file rather than calling the Teams API itself, and treats the file's keys as the authoritative frozen-teams list — it no longer parses the raw `frozen-teams` input. It intersects team membership with the pull request participant set.

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

resolve the active members of every frozen team            # dist/resolve-team-membership/index.js,
                                                             # unconditional whenever this step runs
write the resolved membership to a JSON file

load and validate trusted repository configuration          # dist/index.js, from here on

if every configured bypass mechanism is satisfied
(bypass-labels: any entry present; bypass-title-pattern: PR title matches):
    pass

collect PR author and the GitHub-linked committer of the current head commit
find intersections between participants and the JSON file's frozen teams

if there are no intersections:
    pass

fail with "Your team is frozen"
```

Team-membership resolution now runs in its own step, unconditionally, before the evaluator even starts — see `docs/Internals/architecture.md`'s Architecture section. This means the bypass check (`shouldBypass` in `src/decision.ts`) can no longer save the team-membership API calls the way it once could when both lived in the same process: those calls always happen when `frozen-teams` is non-empty, bypass or not. The bypass check still runs before participant resolution inside the evaluator, so it still saves the one API call needed to identify the head commit's committer (`resolveParticipants` in `src/github/participants.ts`) on a satisfied bypass.

The `frozen-teams`-empty short circuit is stricter than "skip participant resolution": it must skip **every** external call, including the Octo STS token exchange and the team-membership API calls, not just the evaluator's own calls. `action.yml` enforces this directly, before either Node program is ever invoked, via a `shell: python` step, "Early checks," that produces a `skip` output the Octo STS step and both `dist/resolve-team-membership/index.js` and `dist/index.js`'s steps are conditioned on:

`frozen-teams` is empty once blank lines are stripped. `inputs.frozen-teams != ''` alone isn't enough here, since a whitespace-only or newline-only value (e.g. `"\n \n"`) is also "no frozen teams" as far as `src/config.ts`'s own parsing would treat it, but isn't the literal `''` string — this step normalizes the same way `splitLines` in `src/config.ts` does before comparing. The `"not set"` sentinel default is deliberately **not** treated as empty here, so an omitted input still reaches `dist/resolve-team-membership/index.js` and fails closed there; because a failed step stops the job by default, `dist/index.js` never runs in that case either.

This means an empty (or whitespace-only) `frozen-teams` configuration makes zero external calls — no Octo STS exchange, no team-membership resolution, no evaluator invocation at all — while a satisfied bypass on an otherwise-frozen pull request still costs the Octo STS exchange and the team-membership resolution (both needed to fail closed on a malformed config before the evaluator's own `shouldBypass` check ever runs) before that check short-circuits participant resolution.

The policy uses **any-match semantics** for participants and within `bypass-labels`: one frozen participant is enough to require a bypass, and any one of the configured `bypass-labels` is enough to satisfy that mechanism. Across mechanisms, semantics are **all-match**: when both `bypass-labels` and `bypass-title-pattern` are configured, both must be satisfied — a bypass label alone, or a matching title alone, does not pass. A mechanism left unconfigured (empty) is treated as satisfied, so a single configured mechanism can bypass on its own. The participant any-match prevents a frozen engineer from bypassing the policy by opening a pull request through another author or committing directly to an existing pull request. It does not prevent a frozen engineer from asking a teammate to both open the pull request and commit on their behalf — see the "Commit authorship is not checked" limitation in `docs/limitations.md`.

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
| `edited` | Re-evaluate when the pull request title changes, since a `bypass-title-pattern` match depends on it. |

Pull request description, assignee, and review changes do not affect the policy and do not require evaluation.

Repository configuration and GitHub team membership changes do not generate these events. They require the explicit reconciliation process described in the user guide.

## Configuration and workflow ownership

The action implementation is centrally maintained, but each repository owns:

- Its `bypass-labels` and `bypass-title-pattern`.
- Its list of frozen teams.

The CI-owning team should own reviews for the workflow files. Incident automation may update the frozen-team list, but those mutations should remain attributable and auditable through Git history.
