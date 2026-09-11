
# Operational limitations

## Configuration changes do not automatically re-evaluate existing pull requests

Changing `frozen-teams` on the default branch does not emit a pull request event for already-open pull requests. A previously successful check can therefore remain successful until the pull request changes.

The incident process must re-run the latest `Team freeze guard` workflow for every open pull request when:

- A team is frozen or unfrozen.
- `bypass-labels` or `bypass-title-pattern` changes.
- Relevant GitHub team membership changes.

This reconciliation should be automated by the system that updates the freeze configuration. If immediate reconciliation cannot be guaranteed, a webhook-based GitHub App is stronger than a pure Action implementation.

After a membership change, dispatch the workflow on its default branch before re-running
pull request checks.

## Label presence and title pattern matching are not authorization

The action verifies that at least one of the configured `bypass-labels` is present, and/or that the pull request title matches `bypass-title-pattern`, when configured. It does not, by itself, restrict who may apply that label or edit the pull request title — anyone able to edit the pull request can typically also edit its title.

If a bypass mechanism represents an approval rather than a self-declared classification, use an additional mechanism to ensure it was applied or approved by an Incident Commander or CI owner. Possible mechanisms include a bot-owned command, an authorized review, or validation of the label or edit event actor.

## Accountability is author-only

The action holds the pull request author accountable and does not inspect commits or other contributors. This relies on users not opening a pull request through another person or bot to work around the process.

## Membership is a snapshot

Membership is refreshed hourly and may be stale until the next refresh. Use `workflow_dispatch` when an immediate refresh is needed. A missing snapshot or one older than three hours fails closed.

Changing the workflow file on the default branch automatically refreshes the snapshot through
its path-filtered `push` trigger. GitHub path filters apply to the whole file, so an unrelated
change to that file also causes one refresh. A pull request check that runs before the refresh
finishes fails closed until the new snapshot exists. The refresh does not rerun completed checks
on existing pull requests.

## Merge queues

The initial design targets ordinary pull request merges. A required check used with GitHub's merge queue must also report correctly for `merge_group` events. Do not enable this check in a merge-queue ruleset until merge-group evaluation has been explicitly implemented and tested.
