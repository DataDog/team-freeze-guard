import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

export class TeamResolutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'TeamResolutionError'
  }
}

export interface ResolveTeamMembershipInput {
  octokit: Octokit
  org: string
  teamSlugs: string[]
}

export async function resolveTeamMembership(
  input: ResolveTeamMembershipInput,
): Promise<Map<string, Set<string>>> {
  const membership = new Map<string, Set<string>>()

  for (const teamSlug of input.teamSlugs) {
    membership.set(teamSlug, await listTeamMembers(input.octokit, input.org, teamSlug))
  }

  return membership
}

async function listTeamMembers(octokit: Octokit, org: string, teamSlug: string): Promise<Set<string>> {
  try {
    const members = await octokit.paginate(octokit.rest.teams.listMembersInOrg, {
      org,
      team_slug: teamSlug,
      per_page: 100,
    })
    return new Set(members.map((member: { login: string }) => member.login))
  } catch (error) {
    const status = getHttpStatus(error)
    if (status === 404 || status === 403) {
      throw new TeamResolutionError(
        `Team "@${org}/${teamSlug}" is unknown or inaccessible with the current token.`,
        { cause: error },
      )
    }
    throw new TeamResolutionError(`Failed to resolve members of team "@${org}/${teamSlug}".`, {
      cause: error,
    })
  }
}

function getHttpStatus(error: unknown): number | null {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const { status } = error as { status: unknown }
    return typeof status === 'number' ? status : null
  }
  return null
}
