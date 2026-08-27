import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveParticipantsInput {
  octokit: Octokit
  owner: string
  repo: string
  headSha: string
  prAuthorLogin: string
}

export interface Participants {
  logins: string[]
  unmappedIdentities: string[]
}

export async function resolveParticipants(input: ResolveParticipantsInput): Promise<Participants> {
  const logins = new Set<string>([input.prAuthorLogin])
  const unmappedIdentities = new Set<string>()

  const { data: commit } = await input.octokit.rest.repos.getCommit({
    owner: input.owner,
    repo: input.repo,
    ref: input.headSha,
  })

  recordIdentity(commit.committer?.login ?? null, commit.commit.committer?.name ?? null, logins, unmappedIdentities)

  return { logins: [...logins], unmappedIdentities: [...unmappedIdentities] }
}

function recordIdentity(
  login: string | null,
  unmappedName: string | null,
  logins: Set<string>,
  unmappedIdentities: Set<string>,
): void {
  if (login) {
    logins.add(login)
    return
  }
  if (unmappedName) {
    unmappedIdentities.add(unmappedName)
  }
}
