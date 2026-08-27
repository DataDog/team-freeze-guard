### Participant identity resolution

The evaluator constructs a deduplicated set of GitHub users from:

1. `pull_request.user.login`.
2. The GitHub-linked `committer.login` of every commit returned for the pull request.

Commit *authorship* is intentionally not checked — only the committer. This is a deliberate simplicity tradeoff: see the "Commit authorship is not checked" limitation in `docs/limitations.md`.

Git committer strings contain names and email addresses, but they do not always map to GitHub accounts. Only identities mapped by GitHub to a user login are used for team-membership enforcement. Unmapped identities are reported as warnings and cannot be reliably associated with a GitHub team.

This design does **not** attempt to identify every person who pushed commits. GitHub does not expose a reliable, complete pusher history for all pull requests, particularly for forks. In this policy, "committer" means the GitHub-linked Git committer recorded on the commit.

Bots normally do not require special handling because they are not members of frozen teams.