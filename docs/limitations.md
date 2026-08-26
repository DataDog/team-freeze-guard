
# Operational limitations

## Configuration changes do not automatically re-evaluate existing pull requests

Changing `frozen-teams` on the default branch does not emit a pull request event for already-open pull requests. A previously successful check can therefore remain successful until the pull request changes.

The incident process must re-run the latest `Team freeze guard` workflow for every open pull request when:

- A team is frozen or unfrozen.
- `bypass-labels` changes.
- Relevant GitHub team membership changes.

This reconciliation should be automated by the system that updates the freeze configuration. If immediate reconciliation cannot be guaranteed, a webhook-based GitHub App is stronger than a pure Action implementation.

## Label presence is not label authorization

The action verifies that at least one of the configured `bypass-labels` is present. It does not, by itself, restrict who may apply that label.

If a bypass label represents an approval rather than a self-declared classification, use an additional mechanism to ensure it was applied or approved by an Incident Commander or CI owner. Possible mechanisms include a bot-owned command, an authorized review, or validation of the label event actor.

## `Co-authored-by` trailers are not evaluated

Participant identity resolution uses the GitHub-linked commit author and committer only. A frozen engineer's contribution recorded solely as a `Co-authored-by:` trailer in a commit message is not detected, since GitHub does not surface trailer identities as a distinct author or committer on the commit. This is an accepted scope limitation, not a bypass GitHub itself can close: closing it would require parsing commit message trailers and mapping free-text identities to GitHub accounts, which is unreliable.

## Merge queues

The initial design targets ordinary pull request merges. A required check used with GitHub's merge queue must also report correctly for `merge_group` events. Do not enable this check in a merge-queue ruleset until merge-group evaluation has been explicitly implemented and tested.
