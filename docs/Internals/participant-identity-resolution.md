### Pull request author accountability

The evaluator uses `pull_request.user.login` as the sole accountable identity. It does not inspect commits or make an API call to resolve authors, committers, or pushers.

This intentionally treats the pull request owner as responsible for every contribution to the pull request. The policy trusts users not to open pull requests through another account to evade a freeze.

Bots normally do not require special handling because they are not members of frozen teams.
