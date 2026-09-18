## Architecture

`team-freeze-guard` is a composite GitHub Action containing three logical components, run as three sequential steps (after an "Early checks" step that can skip all of them when `frozen-teams` is empty — see `docs/Internals/README.md`'s Decision algorithm):

1. **Token retrieval:** `DataDog/dd-octo-sts-action` exchanges the job's GitHub OIDC identity for a short-lived, organization-scoped GitHub App token to read membership data.
2. **Team membership resolution:** a bundled Node.js program (`dist/resolve-team-membership/index.js`) uses that token to list the members of every configured frozen team and writes the result to a JSON file on the runner's filesystem (`runner.temp`).
3. **Policy evaluation:** a second bundled Node.js program (`dist/index.js`) reads the repository configuration and pull request state, reads the team-membership JSON file written by step 2 (it does not call the Teams API itself), and succeeds or fails the Action job.

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
   Team membership resolution ---> Team membership API
                |
                v
   Team membership JSON file (runner.temp)
                |
                v
       Team freeze evaluator
        /              \
       v                v
Repository/PR APIs   Team membership JSON file
       \                /
        v              v
       Pass or fail required check
```

The consumer sees a single action call, while token retrieval remains centralized and does not require a PAT, repository secret, or GitHub App private key. The JSON file hand-off between steps 2 and 3 also doubles as the payload for the optional team-membership cache (see "Team-membership caching" below).


## Why a composite action

A JavaScript action cannot directly invoke another GitHub Action. A composite action can call `DataDog/dd-octo-sts-action` and then run the bundled team-membership resolution and evaluator programs as subsequent steps.

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

The action retrieves configuration through the `with` inputs of the `team-freeze-guard.yml` workflow definition: the evaluator step reads `bypass-labels` and `bypass-title-pattern` directly, while `frozen-teams` is consumed by the separate "Resolve frozen team membership" step and reaches the evaluator only as the resolved membership file's keys (see `docs/Internals/implementation-plan.md`'s PR 8). It does not rely on a workspace checkout.

Because `pull_request_target` always evaluates the workflow definition from the base branch, a pull request cannot change its own `frozen-teams`, `bypass-labels`, or `bypass-title-pattern` by editing the workflow file on its own branch — the base-branch version is authoritative regardless of what the pull request contains. The pull request *title* itself, however, is untrusted input read from the event payload (like labels), not from this trusted configuration.


### Team-membership caching

`actions/cache` cannot save anything from a `pull_request_target`-triggered run, and never will be able to, regardless of the calling workflow's declared `permissions:`, of repo-level cache settings, or of how the cache action is invoked. GitHub issues read-only Actions cache tokens for `pull_request`/`pull_request_target`-triggered runs ("read-only Actions cache for untrusted triggers"), so a save from one of these runs always fails with `cache write denied: token has no writable scopes`. This was tried once with the write happening from the same `pull_request_target` run (see `docs/Internals/implementation-plan.md`'s PR 9) and reverted after live e2e testing confirmed the write is always denied.

A `pull_request_target` run can still *restore* a cache entry — only the write token is restricted — so `action.yml`'s "Restore cached team membership" step runs unconditionally. What writes that entry is a separate, optional workflow the consumer adds, triggered by `push`, `schedule`, or `workflow_dispatch`: none of those triggers are subject to the read-only restriction, so `action.yml`'s "Save team membership cache" step runs only for them (see the README's "Caching team membership" section). The cache key is a hash of `frozen-teams` only, with no time component, so a `pull_request_target` run's restore either hits data written by the most recent successful warm-up run for that exact `frozen-teams` value, or misses and falls back to resolving membership itself.

`actions/cache/save` cannot overwrite an existing entry for a key that's already occupied — it just logs a warning and keeps the old entry. Since this design intentionally reuses the same key across every warm-up run (there is no time component), each warm-up run first deletes any existing entry for that key (`gh cache delete`, via the "Delete stale team membership cache entry" step) before saving, so the cache actually refreshes on the consumer's own `push`/`schedule`/`workflow_dispatch` cadence instead of only ever writing once.