# Team Freeze Guard

`team-freeze-guard` enforces per-team code freezes on GitHub pull requests.

When a pull request author, commit author, or commit committer belongs to a configured frozen GitHub team, the pull request must carry a configured exception label. Otherwise, the action fails with `Your team is frozen`, and a required GitHub ruleset check prevents the pull request from being merged.

The action uses [DataDog/dd-octo-sts-action](https://github.com/DataDog/dd-octo-sts-action) internally to obtain a short-lived GitHub token with organization membership permissions. It does not require a personal access token or a GitHub App private key in the consuming repository.

## How it works

For every relevant pull request event, the action evaluates this rule:

* is there any frozen team ? 
    * No -> pass
* is the required label present ?
    * Yes -> pass
* is a participant member of those teams ?
    * No -> pass
* fail

A participant is:

- The pull request author.
- The GitHub-linked author of any commit currently in the pull request.
- The GitHub-linked committer of any commit currently in the pull request.


## Workflow configuration

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
  pull-requests: read

jobs:
  team-freeze-guard:
    name: Team freeze guard
    runs-on: ubuntu-latest

    steps:
      - uses: DataDog/team-freeze-guard@<full-commit-sha>
        with: 
          required_label: ci-remediation
          frozen_teams: |
            @DataDog/apm-sdk
            @DataDog/profiling
```

Team names must be GitHub team slugs, not display names. For example, configure `@DataDog/apm-sdk`, not `@DataDog/APM SDK` or `apm-sdk`.

Do not add a checkout step. The action reads the pull request and the trusted configuration through the `with` blocks; it must never execute code from the pull request branch.

An empty `frozen_teams` values means that no check is performed (no code freeze):

```yml
        with: 
          required_label: ci-remediation
          frozen_teams:
```

### Configuration fields

| Field | Required | Default | Description |
| --- | --- | --- | --- |
| `required_label` | Yes | None | Label required when at least one participant belongs to a frozen team. Matching is case-insensitive. |
| `frozen_teams` | Yes | None | List of frozen GitHub team slugs. An empty list disables all freezes. |


### Required workflow permissions

| Permission | Reason |
| --- | --- |
| `id-token: write` | Allows `dd-octo-sts-action` to exchange the workflow's OIDC identity for a short-lived GitHub App token. |

An action cannot grant these permissions to itself; they must be declared by the calling workflow.

Keep `team-freeze-guard` alone in its job. `id-token: write` applies to every step in the job, so unrelated third-party actions should not share the same job.

The organization scope, Octo STS policy name, and Octo STS pool are intentionally controlled by the action rather than exposed as repository inputs.

## Octo STS trust policy

The action internally requests an organization-scoped token from `dd-octo-sts-action`. The corresponding trust policy must:

- Trust the calling repository and its protected workflow context.
- Grant only the GitHub organization `Members: read` permission.
- Be stored in the canonical organization trust-policy location.

An illustrative policy is:

```yaml
issuer: https://token.actions.githubusercontent.com
subject: repo:DataDog/<repository>:ref:refs/heads/<default-branch>

permissions:
  members: read
```

Adapt the subject and any additional claims to DataDog's canonical Octo STS policy conventions. The underlying Octo STS GitHub App installation must itself have `Members: read`; a trust policy cannot grant permissions that the App does not possess.

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
| A participant belongs to a frozen team and the label is absent | Fail |
| A participant belongs to a frozen team and the label is present | Pass |
| The required label is removed | Re-evaluate and fail |
| A new commit introduces a frozen participant | Re-evaluate and require the label |
| The configuration is missing or malformed | Fail |
| GitHub or Octo STS cannot be queried reliably | Fail |

Example failure summary:

```text
Your team is frozen.

At least one pull request participant belongs to @DataDog/apm-sdk.
Add the `ci-remediation` label before merging this pull request.
```

## Protecting the policy files

Protect these paths with `CODEOWNERS` and required review from the CI-owning team:

```text
/.github/workflows/team-freeze-guard.yml
```

Otherwise, someone able to merge changes to either file could weaken or remove the enforcement policy.
