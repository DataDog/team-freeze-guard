# Testing strategy

The evaluator should have unit tests covering:

- Empty frozen-team lists.
- Frozen and non-frozen PR authors.
- Author-only accountability and overlapping team membership.
- Label presence and removal.
- Case-sensitive label matching.
- Multiple configured `bypass-labels` (any-match).
- Batched and paginated GraphQL team results.
- Missing, malformed, mismatched, and stale membership snapshots.
- Missing, malformed, and unsupported configuration versions.
- Refresh-time GitHub API, Octo STS, rate-limit, and pagination failures.

Integration tests should verify:

- OIDC exchange from a push, scheduled, or manually dispatched refresh run.
- Cache save from refresh and restore from `pull_request_target`.
- Pull requests from both repository branches and forks.
- Status-check enforcement in ruleset Evaluate and Active modes.
- Re-evaluation on every configured pull request event.
