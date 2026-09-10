# Team Freeze Guard

`team-freeze-guard` enforces per-team code freezes on GitHub pull requests.

When a pull request author or commit committer belongs to a configured frozen GitHub team, the pull request must carry at least one of the configured bypass labels. Otherwise, the action fails with `Your team is frozen`, and a required GitHub ruleset check prevents the pull request from being merged.

The action uses [DataDog/dd-octo-sts-action](https://github.com/DataDog/dd-octo-sts-action) internally to obtain a short-lived GitHub token with organization membership permissions. It does not require a personal access token or a GitHub App private key in the consuming repository. This GitHub Action does not contain any other mechanism for obtaining this membership permission, which means it is meant to work only on DataDog's org repositories.

## How it works

For every relevant pull request event, the action evaluates this rule:

```mermaid
flowchart TD
    A["Is any team frozen?"] -->|No| PASS1["Pass"]
    A -->|Yes| B["Is a bypass label present?"]
    B -->|Yes| PASS2["Pass"]
    B -->|No| C["Is a participant member of a frozen team?"]
    C -->|No| PASS3["Pass"]
    C -->|Yes| FAIL["Fail"]
```

A participant is:

- The pull request author.
- The GitHub-linked committer of the pull request's current head commit.

Only the current head commit is checked, not the pull request's full commit history, and commit *authorship* is not checked, only the committer — see [`docs/limitations.md`](docs/limitations.md) for the tradeoffs this implies.


## Workflow configuration

The workflow uses `pull_request_target` rather than `pull_request` because it needs a trusted OIDC identity and correct permissions even for pull requests from forks, which `pull_request` cannot provide. Do not change the trigger to `pull_request`.

Create `.github/workflows/team-freeze-guard.yml`:

```yaml
name: Team freeze guard

on:
  pull_request_target:
    types:
      - opened
      - reopened
      - synchronize
      - labeled
      - unlabeled
      - ready_for_review

permissions:
  id-token: write
  contents: read

jobs:
  team-freeze-guard:
    name: Team freeze guard
    runs-on: ubuntu-latest

    steps:
      - uses: DataDog/team-freeze-guard@<full-commit-sha>
        with: 
          bypass-labels: |
            ci-remediation
          frozen-teams: |
            @DataDog/apm-sdk
            @DataDog/profiling
```

Pin `team-freeze-guard` to a full commit SHA, and track new releases explicitly (for example with Dependabot's `github-actions` ecosystem) rather than floating a tag or branch, so upgrades are a reviewed, deliberate change.

Team names must be GitHub team slugs, not display names. For example, configure `@DataDog/apm-sdk`, not `@DataDog/APM SDK` or `apm-sdk`.

`frozen-teams` is a newline-delimited list, one `@org/team-slug` per line, as shown above. Blank lines are ignored. Every team must belong to the same GitHub organization as the repository; a team from another organization is rejected as a configuration error, since the Octo STS token is scoped to a single organization.

`bypass-labels` is also a newline-delimited list, one label name per line. A pull request needs only one of the configured labels to satisfy the check; matching is case-sensitive, so a configured label must match the pull request's label exactly.

Do not add a checkout step. The action reads the pull request and the trusted configuration through the `with` blocks; it must never execute code from the pull request branch.

An empty `frozen-teams` values means that no check is performed (no code freeze):

```yml
        with: 
          bypass-labels: |
            ci-remediation
          frozen-teams:
```

### Configuration fields

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `bypass-labels` | Yes | None | Newline-delimited list of labels; any one present satisfies the check when a participant belongs to a frozen team. Matching is case-sensitive. |
| `frozen-teams` | Yes | None | Newline-delimited list of frozen GitHub team slugs. An empty list disables all freezes. |
| `frozen-message` | No | `Your team is frozen` | Message used as the check failure reason and summary heading when a frozen team participates. |


### Required workflow permissions

| Permission | Reason |
| --- | --- |
| `id-token: write` | Allows `dd-octo-sts-action` to exchange the workflow's OIDC identity for a short-lived GitHub App token. |
| `contents: read` | Allows the default `GITHUB_TOKEN` to read repository and commit data needed to resolve the head commit's committer. |

An action cannot grant these permissions to itself; they must be declared by the calling workflow.

Keep `team-freeze-guard` alone in its job. `id-token: write` applies to every step in the job, so unrelated third-party actions should not share the same job.

The organization scope, Octo STS policy name, and Octo STS pool are intentionally controlled by the action rather than exposed as repository inputs.

## Enforcing the result with a ruleset

Running the action is not sufficient by itself. Configure a GitHub repository or organization ruleset that requires the following status check on the target branch:

```text
Team freeze guard
```

Recommended rollout:

1. Add the repository configuration and workflow.
2. Run the check on representative pull requests.
3. Add the required status check to a ruleset in **Evaluate** mode.
4. Confirm that the ruleset reports the expected violations.
5. Change the ruleset to **Active**.
6. Configure the ruleset so that administrators do not silently bypass it, except for explicitly approved incident procedures.

Keep the job name stable. Changing it changes the status-check name and can leave the ruleset waiting for a check that is no longer produced.

## Expected behavior

| Situation | Result |
| --- | --- |
| No frozen teams are configured | Pass |
| No participant belongs to a frozen team | Pass |
| A participant belongs to a frozen team and no bypass label is present | Fail |
| A participant belongs to a frozen team and a bypass label is present | Pass |
| The last remaining bypass label is removed while a participant belongs to a frozen team | Re-evaluate and fail |
| A new commit introduces a frozen participant | Re-evaluate and require a bypass label |
| The configuration is missing or malformed | Fail |
| A configured frozen team is unknown or inaccessible | Fail |
| GitHub or Octo STS cannot be queried reliably (rate limiting, pagination, or unexpected responses) | Fail |

Example failure summary:

```text
Your team is frozen.

- @octocat belongs to frozen team @DataDog/apm-sdk.
If your PR is meant to fix the freeze cause, add the relevant label: `ci-remediation`.
```

## Protecting the policy files

Protect this path with `CODEOWNERS` and required review from the CI-owning team:

```text
/.github/workflows/team-freeze-guard.yml
```

Otherwise, someone able to merge changes to this file could weaken or remove the enforcement policy.

See [`docs/limitations.md`](docs/limitations.md) for known operational limitations, including reconciliation after configuration or team-membership changes, label authorization, and merge queue support.
