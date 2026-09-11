## Architecture

`team-freeze-guard` is a composite GitHub Action containing two operations:

1. **Refresh:** a trusted default-branch push, scheduled, or manually dispatched run uses
   `DataDog/dd-octo-sts-action` and normally one batched GraphQL query to write a
   team-membership snapshot.
2. **Evaluation:** a `pull_request_target` run restores that snapshot and checks the pull
   request author without making GitHub API calls.

```text
Trusted push/schedule/workflow_dispatch    Trusted pull_request_target
                   |                                  |
                   v                                  v
    Octo STS -> GitHub GraphQL                 Restore snapshot
                   |                                  |
                   v                                  v
            Save snapshot                   Check PR event author
                                                      |
                                                      v
                                             Pass or fail check
```

The action selects the operation from `github.event_name`; consumers use the same action call
for every supported trigger. Token retrieval remains centralized and does not require a PAT,
repository secret, or GitHub App private key.


## Why a composite action

A JavaScript action cannot directly invoke other GitHub Actions. A composite action can invoke Octo STS and the cache actions around the bundled program.

This provides one interface for both refresh and evaluation.

The composite action cannot define workflow triggers, job permissions, or repository rulesets. Those remain explicit in the consuming repository because GitHub evaluates them before the action starts.


### Trusted execution model

The evaluation workflow uses `pull_request_target` so GitHub executes its definition and configuration from the trusted base branch, including for pull requests from forks.

Because `pull_request_target` runs with privileges associated with the base repository, the implementation follows these rules:

- Never check out the pull request head.
- Never run scripts, actions, or binaries supplied by the pull request.
- Never read the configuration from the pull request head.
- Treat pull request titles, branch names, labels, commit metadata, and usernames as untrusted data.
- Pass untrusted values through API parameters or environment variables, never interpolate them into executable shell commands.
- Pin nested actions, including `dd-octo-sts-action`, to reviewed full commit SHAs.


### Configuration source

The evaluator retrieves configuration (`bypass-labels`, `bypass-title-pattern`, `frozen-teams`) through the `with` inputs of the `team-freeze-guard.yml` workflow definition. It does not rely on a workspace checkout.

Because `pull_request_target` always evaluates the workflow definition from the base branch, a pull request cannot change its own `frozen-teams`, `bypass-labels`, or `bypass-title-pattern` by editing the workflow file on its own branch — the base-branch version is authoritative regardless of what the pull request contains. The pull request *title* itself, however, is untrusted input read from the event payload (like labels), not from this trusted configuration.


### GitHub Actions cache

`pull_request_target` receives a read-only cache token, which is why the earlier attempt to
restore and save in the pull request job failed. The new design writes immutable cache entries
from trusted `push`, `schedule`, and `workflow_dispatch` runs and only restores them from pull
request runs. Snapshots are bound to the configured team list and rejected after three hours.
