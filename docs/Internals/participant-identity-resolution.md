### Participant identity resolution

The evaluator constructs a deduplicated set of GitHub users from:

1. `pull_request.user.login`.
2. The GitHub-linked `committer.login` of the pull request's **current head commit only** — `pull_request.head.sha` — fetched with a single `GET /repos/{owner}/{repo}/commits/{sha}` call, not the full commit history.

Commit *authorship* is intentionally not checked — only the committer. This is a deliberate simplicity tradeoff: see the "Commit authorship is not checked" limitation in `docs/limitations.md`.

Only the head commit is fetched, not every commit in the pull request. Every relevant event (`opened`, `synchronize`, `labeled`, `unlabeled`) re-runs this evaluation against whatever the head commit is at that moment, so a `synchronize` event that pushes a new commit re-evaluates that new commit as the new head. This is a deliberate simplicity/cost tradeoff, not an oversight: see the "Only the head commit is checked" limitation in `docs/limitations.md` for the gap it implies.

Git committer strings contain names and email addresses, but they do not always map to GitHub accounts. Only identities mapped by GitHub to a user login are used for team-membership enforcement. Unmapped identities are reported as warnings and cannot be reliably associated with a GitHub team.

This design does **not** attempt to identify every person who pushed commits. GitHub does not expose a reliable, complete pusher history for all pull requests, particularly for forks. In this policy, "committer" means the GitHub-linked Git committer recorded on the head commit.

Bots normally do not require special handling because they are not members of frozen teams.