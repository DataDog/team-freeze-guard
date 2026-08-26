
## Operational limitations

### Configuration changes do not automatically re-evaluate existing pull requests

Changing `frozen_teams` on the default branch does not emit a pull request event for already-open pull requests. A previously successful check can therefore remain successful until the pull request changes.

The incident process must re-run the latest `Team freeze guard` workflow for every open pull request when:

- A team is frozen or unfrozen.
- The required label changes.
- Relevant GitHub team membership changes.

This reconciliation should be automated by the system that updates the freeze configuration. If immediate reconciliation cannot be guaranteed, a webhook-based GitHub App is stronger than a pure Action implementation.

### Label presence is not label authorization

The action verifies that the configured label is present. It does not, by itself, restrict who may apply that label.

If the label represents an approval rather than a self-declared classification, use an additional mechanism to ensure it was applied or approved by an Incident Commander or CI owner. Possible mechanisms include a bot-owned command, an authorized review, or validation of the label event actor.

### Merge queues

The initial design targets ordinary pull request merges. A required check used with GitHub's merge queue must also report correctly for `merge_group` events. Do not enable this check in a merge-queue ruleset until merge-group evaluation has been explicitly implemented and tested.
