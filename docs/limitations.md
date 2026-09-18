
# Operational limitations

## Configuration changes do not automatically re-evaluate existing pull requests

Changing `frozen-teams` on the default branch does not emit a pull request event for already-open pull requests. A previously successful check can therefore remain successful until the pull request changes.

The incident process must re-run the latest `Team freeze guard` workflow for every open pull request when:

- A team is frozen or unfrozen.
- `bypass-labels` or `bypass-title-pattern` changes.
- Relevant GitHub team membership changes.

This reconciliation should be automated by the system that updates the freeze configuration. If immediate reconciliation cannot be guaranteed, a webhook-based GitHub App is stronger than a pure Action implementation.

## Label presence and title pattern matching are not authorization

The action verifies that at least one of the configured `bypass-labels` is present, and/or that the pull request title matches `bypass-title-pattern`, when configured. It does not, by itself, restrict who may apply that label or edit the pull request title — anyone able to edit the pull request can typically also edit its title.

If a bypass mechanism represents an approval rather than a self-declared classification, use an additional mechanism to ensure it was applied or approved by an Incident Commander or CI owner. Possible mechanisms include a bot-owned command, an authorized review, or validation of the label or edit event actor.

## Only the pull request author is checked

Participant identity resolution considers only `pull_request.user.login` — the pull request author. It does not look at commit committers, commit authors, or `Co-authored-by:` trailers.

The consequence: a frozen-team engineer can ask a teammate to open the pull request and commit on their behalf, or to add commits of their own to someone else's pull request, without appearing as the author, and the check cannot detect this. This is treated as an accepted gap, not a technical bypass to close: circumventing a freeze by asking a colleague to front a change on your behalf is a process/HR issue, not something this check is expected to prevent.

## Merge queues

The initial design targets ordinary pull request merges. A required check used with GitHub's merge queue must also report correctly for `merge_group` events. Do not enable this check in a merge-queue ruleset until merge-group evaluation has been explicitly implemented and tested.
