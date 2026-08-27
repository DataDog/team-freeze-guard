import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveParticipantsInput {
  octokit: Octokit
  owner: string
  repo: string
  pullNumber: number
  prAuthorLogin: string
}

export interface Participants {
  logins: string[]
  unmappedIdentities: string[]
}

export async function resolveParticipants(input: ResolveParticipantsInput): Promise<Participants> {
  const logins = new Set<string>([input.prAuthorLogin])
  const unmappedIdentities = new Set<string>()

  const commits = await input.octokit.paginate(input.octokit.rest.pulls.listCommits, {
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullNumber,
  })

  for (const commit of commits) {
    recordIdentity(commit.committer?.login ?? null, commit.commit.committer?.name ?? null, logins, unmappedIdentities)
  }

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
