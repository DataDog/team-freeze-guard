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
  /** Frozen team handles in "@org/team-slug" form, as produced by config parsing. */
  teamHandles: string[]
}

export async function resolveTeamMembership(
  input: ResolveTeamMembershipInput,
): Promise<Map<string, Set<string>>> {
  const membership = new Map<string, Set<string>>()

  for (const teamHandle of input.teamHandles) {
    const teamSlug = extractTeamSlug(teamHandle)
    membership.set(teamHandle, await listTeamMembers(input.octokit, input.org, teamHandle, teamSlug))
  }

  return membership
}

function extractTeamSlug(teamHandle: string): string {
  const slug = teamHandle.split('/')[1]
  if (!slug) {
    throw new TeamResolutionError(`"${teamHandle}" is not a valid "@org/team-slug" handle.`)
  }
  return slug
}

async function listTeamMembers(
  octokit: Octokit,
  org: string,
  teamHandle: string,
  teamSlug: string,
): Promise<Set<string>> {
  try {
    const members = await octokit.paginate(octokit.rest.teams.listMembersInOrg, {
      org,
      team_slug: teamSlug,
      per_page: 100,
    })
    return new Set(members.map((member: { login: string }) => member.login))
  } catch (error) {
    const status = getHttpStatus(error)
    if (status === 404) {
      throw new TeamResolutionError(`Team "${teamHandle}" is unknown.`, { cause: error })
    }
    if (status === 403) {
      throw new TeamResolutionError(`Team "${teamHandle}" is inaccessible with the current token.`, {
        cause: error,
      })
    }
    throw new TeamResolutionError(`Failed to resolve members of team "${teamHandle}".`, {
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
