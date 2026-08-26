
## Octo STS trust policy

The action internally requests an organization-scoped token from `dd-octo-sts-action`. The corresponding trust policy must:

- Trust the calling repository and its protected workflow context.
- Grant only the GitHub organization `Members: read` permission.
- Be stored in the canonical organization trust-policy location.

An illustrative policy is:

```yaml
issuer: https://token.actions.githubusercontent.com
subject: repo:DataDog/<repository>:ref:refs/heads/<default-branch>

permissions:
  members: read
```

Adapt the subject and any additional claims to DataDog's canonical Octo STS policy conventions. The underlying Octo STS GitHub App installation must itself have `Members: read`; a trust policy cannot grant permissions that the App does not possess.
