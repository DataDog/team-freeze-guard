
## Octo STS trust policy

The action internally requests an organization-scoped token from `dd-octo-sts-action`. The corresponding trust policy must:

- Trust the calling repository and its protected workflow context.
- Grant only the GitHub organization `Members: read` permission.
- Be stored in the canonical organization trust-policy location.

The real policy is published org-wide in `DataDog/.github` at `.github/chainguard/team-freeze-guard.read-org-members.sts.yaml` (added in [DataDog/.github#457](https://github.com/DataDog/.github/pull/457)), referenced from `action.yml` as `scope: DataDog`, `policy: team-freeze-guard.read-org-members`:

```yaml
issuer: https://token.actions.githubusercontent.com

subject: repo:DataDog/team-freeze-guard:ref:refs/heads/main

claim_pattern:
  event_name: pull_request_target
  ref: refs/heads/main
  repository: DataDog/team-freeze-guard

permissions:
  members: read
```

`team-freeze-guard` is a reusable composite action meant to be adopted by many repos, but this policy currently authorizes only the action's own repo, since no other repo has adopted it yet — the OIDC identity for a caller invoking this action reflects the *caller's* repo, not `team-freeze-guard`'s, so broadening this to a wider `subject_pattern` is a deliberate future change (requiring explicit confirmation per the dd-octo-sts guide's guardrails on broad patterns), not something to guess at preemptively. Add further repos to the policy's `subject_pattern` as they onboard.

The underlying Octo STS GitHub App installation must itself have `Members: read`; a trust policy cannot grant permissions that the App does not possess.
