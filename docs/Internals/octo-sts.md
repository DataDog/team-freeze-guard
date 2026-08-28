
## Octo STS trust policy

The action internally requests an organization-scoped token from `dd-octo-sts-action`. The corresponding trust policy must:

- Trust the calling repository and its protected workflow context.
- Grant only the GitHub organization `Members: read` permission.
- Be stored in the canonical organization trust-policy location.

The real policy is published org-wide in `DataDog/.github` at `.github/chainguard/team-freeze-guard.read-org-members.sts.yaml` (added in [DataDog/.github#457](https://github.com/DataDog/.github/pull/457)), referenced from `action.yml` as `scope: DataDog`, `policy: team-freeze-guard.read-org-members`:

```yaml
issuer: https://token.actions.githubusercontent.com

subject_pattern: repo:DataDog/(dd-trace-js:ref:refs/heads/master|system-tests:ref:refs/heads/main|team-freeze-guard:ref:refs/heads/main)

claim_pattern:
  event_name: pull_request_target
  ref: refs/heads/(main|master)
  repository: DataDog/(dd-trace-js|system-tests|team-freeze-guard)

permissions:
  members: read
```

`team-freeze-guard` is a reusable composite action meant to be adopted by many repos, but this policy only authorizes the specific repos it lists, added as they onboard — the OIDC identity for a caller invoking this action reflects the *caller's* repo, not `team-freeze-guard`'s, so broadening this to match any DataDog repo is a deliberate decision to avoid (requiring explicit confirmation per the dd-octo-sts guide's guardrails on broad patterns), not something to guess at preemptively. `subject_pattern` pairs each onboarded repo with its own default branch explicitly (`main` vs. `master`) rather than a flat cross product of repos and branches, which would otherwise also wrongly accept, e.g., `system-tests` on `master`. Add further repos (and their branch) to `subject_pattern` and `claim_pattern.repository` as they onboard.

The underlying Octo STS GitHub App installation must itself have `Members: read`; a trust policy cannot grant permissions that the App does not possess.
