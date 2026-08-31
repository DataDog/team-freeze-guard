
# Operational limitations

## Configuration changes do not automatically re-evaluate existing pull requests

Changing `frozen-teams` on the default branch does not emit a pull request event for already-open pull requests. A previously successful check can therefore remain successful until the pull request changes.

The incident process must re-run the latest `Team freeze guard` workflow for every open pull request when:

- A team is frozen or unfrozen.
- `bypass-labels` changes.
- Relevant GitHub team membership changes.

This reconciliation should be automated by the system that updates the freeze configuration. If immediate reconciliation cannot be guaranteed, a webhook-based GitHub App is stronger than a pure Action implementation.

Team membership itself is additionally cached for up to one hour (see README's "Team membership caching") independently of this reconciliation gap — a membership change can take up to an hour to be reflected even on a pull request that does get re-evaluated.

## Label presence is not label authorization

The action verifies that at least one of the configured `bypass-labels` is present. It does not, by itself, restrict who may apply that label.

If a bypass label represents an approval rather than a self-declared classification, use an additional mechanism to ensure it was applied or approved by an Incident Commander or CI owner. Possible mechanisms include a bot-owned command, an authorized review, or validation of the label event actor.

## `Co-authored-by` trailers are not evaluated

Participant identity resolution uses the GitHub-linked commit committer only (see below). A frozen engineer's contribution recorded solely as a `Co-authored-by:` trailer in a commit message is not detected, since GitHub does not surface trailer identities as a distinct author or committer on the commit. This is an accepted scope limitation, not a bypass GitHub itself can close: closing it would require parsing commit message trailers and mapping free-text identities to GitHub accounts, which is unreliable.

## Commit authorship is not checked

Participant identity resolution only considers the pull request author and the GitHub-linked *committer* of the current head commit — not the commit *author*. This is a deliberate simplicity tradeoff: checking committer alone is simpler to implement and reason about than also resolving and deduplicating commit authors.

The consequence: a frozen-team engineer can ask a teammate to open the pull request and commit on their behalf (e.g. via `git commit --author`), which the check cannot detect — the frozen engineer never appears as the PR author or as a committer. This is treated as an accepted gap, not a technical bypass to close: circumventing a freeze by asking a colleague to front a change on your behalf is a process/HR issue, not something this check is expected to prevent.

## Only the head commit is checked

Participant identity resolution fetches only the pull request's current head commit (`pull_request.head.sha`), not every commit in the pull request's history. This is a deliberate cost/simplicity tradeoff: one API call per evaluation instead of a paginated list of every commit.

The consequence: a commit's committer is only checked at the moment it becomes (or is part of establishing) the head commit under evaluation. In practice this means:

- A `synchronize` event re-evaluates the new head commit each time commits are pushed, so an individual push is checked as it happens.
- However, if a pull request is opened from a branch that already contained multiple commits (or a force-push replaces several commits at once), only the resulting head commit's committer is checked — the committers of the other, non-head commits bundled into that same event are not.

This is an accepted scope limitation, not a bypass GitHub itself can close: checking every commit would require paginating the full commit list on every evaluation, which is the API cost this design deliberately avoids.

## Merge queues

The initial design targets ordinary pull request merges. A required check used with GitHub's merge queue must also report correctly for `merge_group` events. Do not enable this check in a merge-queue ruleset until merge-group evaluation has been explicitly implemented and tested.
