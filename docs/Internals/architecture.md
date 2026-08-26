## Architecture

`team-freeze-guard` is a composite GitHub Action containing two logical components:

1. **Token retrieval:** `DataDog/dd-octo-sts-action` exchanges the job's GitHub OIDC identity for a short-lived, organization-scoped GitHub App token to read membership data.
2. **Policy evaluation:** a bundled Node.js program reads the repository configuration and pull request state, resolves team membership, and succeeds or fails the Action job.

```text
Trusted pull_request_target workflow
                |
                v
       GitHub OIDC identity
                |
                v
       DataDog/dd-octo-sts-action
                |
                v
 Short-lived token with Members: read
                |
                v
       Team freeze evaluator
        /              \
       v                v
Repository/PR APIs   Team membership API
       \                /
        v              v
       Pass or fail required check
```

The consumer sees a single action call, while token retrieval remains centralized and does not require a PAT, repository secret, or GitHub App private key.


## Why a composite action

A JavaScript action cannot directly invoke another GitHub Action. A composite action can call `DataDog/dd-octo-sts-action` and then run the bundled evaluator as a second step.

This provides a one-step consumer interface while preserving the existing Octo STS implementation and trust policies.

The composite action cannot define workflow triggers, job permissions, or repository rulesets. Those remain explicit in the consuming repository because GitHub evaluates them before the action starts.


### Trusted execution model

The workflow uses `pull_request_target` so GitHub executes the workflow definition from the trusted base branch and can issue an OIDC identity for the protected context, including for pull requests from forks.

Because `pull_request_target` runs with privileges associated with the base repository, the implementation follows these rules:

- Never check out the pull request head.
- Never run scripts, actions, or binaries supplied by the pull request.
- Never read the configuration from the pull request head.
- Treat pull request titles, branch names, labels, commit metadata, and usernames as untrusted data.
- Pass untrusted values through API parameters or environment variables, never interpolate them into executable shell commands.
- Pin nested actions, including `dd-octo-sts-action`, to reviewed full commit SHAs.


### Configuration source

The evaluator retrieves configuration through the workflow file definition. It does rely on a workspace checkout.

This does not prevents a pull request from modifying `.github/code-freeze.yml` and having the modified policy apply to itself. This is a tradeoff to keep the workflow simple. We'll consider later on to store this configuration in another place, with precise permissions.