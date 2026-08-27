# Testing strategy

The evaluator should have unit tests covering:

- Empty frozen-team lists.
- Frozen and non-frozen PR authors.
- Frozen and non-frozen commit committers.
- Duplicate identities and overlapping team membership.
- Mapped and unmapped commit identities.
- Label presence and removal.
- Case-sensitive label matching.
- Multiple configured `bypass-labels` (any-match).
- Nested and paginated team results.
- Missing, malformed, and unsupported configuration versions.
- GitHub API, Octo STS, rate-limit, and pagination failures.

Integration tests should verify:

- OIDC exchange through `dd-octo-sts-action`.
- Organization team lookup using the resulting token.
- Pull requests from both repository branches and forks.
- Status-check enforcement in ruleset Evaluate and Active modes.
- Re-evaluation on every configured pull request event.

