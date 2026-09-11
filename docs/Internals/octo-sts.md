
## Octo STS trust policy

Only trusted `push`, `schedule`, and `workflow_dispatch` runs request an organization-scoped
token from `dd-octo-sts-action`, which is internal to DataDog. As a direct consequence, this
GitHub Action won't work on any repository other than DataDog's.

The corresponding trust policy must:

- Trust path-filtered pushes, scheduled runs, and manual dispatches on each calling
  repository's default branch.
- Grant only the GitHub organization `Members: read` permission.
- Be stored in the canonical organization trust-policy location.

The existing policy is published org-wide in `DataDog/.github` at
`.github/chainguard/team-freeze-guard.read-org-members.sts.yaml`, and is referenced from
`action.yml` as `scope: DataDog`, `policy: team-freeze-guard.read-org-members`. It cannot
live in a consuming repository because `Members: read` is an organization-scoped
permission. Its abbreviated shape is:

```yaml
issuer: https://token.actions.githubusercontent.com

subject_pattern: repo:DataDog/(dd-trace-js|system-tests|team-freeze-guard):(pull_request|ref:refs/heads/(main|master))

claim_pattern:
  event_name: (pull_request_target|push|schedule|workflow_dispatch)
  ref: refs/heads/(main|master)
  repository: DataDog/(dd-trace-js|system-tests|team-freeze-guard)

permissions:
  members: read
```

`team-freeze-guard` is a reusable composite action meant to be adopted by many repos, but
this policy only authorizes the specific repos it lists, added as they onboard. The OIDC
identity reflects the *caller's* repo, not `team-freeze-guard`'s, so broadening this to match
any DataDog repo is a deliberate decision to avoid. Add further repos to `subject_pattern`
and `claim_pattern.repository` as they onboard. The `pull_request_target` authorization is
retained for compatibility with older action versions that request the token while
evaluating a pull request.

The underlying Octo STS GitHub App installation must itself have `Members: read`; a trust policy cannot grant permissions that the App does not possess.
