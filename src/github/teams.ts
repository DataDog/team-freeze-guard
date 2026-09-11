// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

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

interface PendingTeam {
  handle: string
  slug: string
  cursor: string | null
}

interface TeamQueryResult {
  members: {
    nodes: Array<{ login: string } | null>
    pageInfo: {
      endCursor: string | null
      hasNextPage: boolean
    }
  }
}

interface TeamMembershipQueryResult {
  organization: Record<string, TeamQueryResult | null> | null
}

const TEAM_HANDLE_PATTERN = /^@([^/]+)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/

export async function resolveTeamMembership(
  input: ResolveTeamMembershipInput,
): Promise<Map<string, Set<string>>> {
  const membership = new Map(input.teamHandles.map((handle) => [handle, new Set<string>()]))
  let pending: PendingTeam[] = input.teamHandles.map((handle) => ({
    handle,
    slug: extractTeamSlug(handle, input.org),
    cursor: null,
  }))

  while (pending.length > 0) {
    const { query, variables } = buildQuery(input.org, pending)
    let result: TeamMembershipQueryResult

    try {
      result = await input.octokit.graphql<TeamMembershipQueryResult>(query, variables)
    } catch (error) {
      throw new TeamResolutionError('Failed to resolve frozen team membership.', {
        cause: error,
      })
    }

    if (!result.organization) {
      throw new TeamResolutionError(`Organization "${input.org}" is unknown or inaccessible.`)
    }

    const nextPage: PendingTeam[] = []
    pending.forEach((team, index) => {
      const teamResult = result.organization?.[`team${index}`]
      if (!teamResult) {
        throw new TeamResolutionError(`Team "${team.handle}" is unknown or inaccessible.`)
      }

      const members = membership.get(team.handle)
      if (!members || !Array.isArray(teamResult.members?.nodes)) {
        throw new TeamResolutionError(`Team "${team.handle}" returned an unexpected response.`)
      }

      for (const member of teamResult.members.nodes) {
        if (!member || typeof member.login !== 'string' || member.login.length === 0) {
          throw new TeamResolutionError(`Team "${team.handle}" returned an invalid member.`)
        }
        members.add(member.login.toLowerCase())
      }

      if (teamResult.members.pageInfo.hasNextPage) {
        const cursor = teamResult.members.pageInfo.endCursor
        if (!cursor) {
          throw new TeamResolutionError(
            `Team "${team.handle}" returned incomplete pagination data.`,
          )
        }
        nextPage.push({ ...team, cursor })
      }
    })
    pending = nextPage
  }

  return membership
}

function extractTeamSlug(teamHandle: string, org: string): string {
  const match = TEAM_HANDLE_PATTERN.exec(teamHandle)
  if (!match) {
    throw new TeamResolutionError(`"${teamHandle}" is not a valid "@org/team-slug" handle.`)
  }

  const [, handleOrg, slug] = match
  if (handleOrg !== org) {
    throw new TeamResolutionError(
      `"${teamHandle}" belongs to organization "${handleOrg}", but membership is being resolved for "${org}".`,
    )
  }

  return slug
}

function buildQuery(org: string, teams: PendingTeam[]): {
  query: string
  variables: Record<string, string | null>
} {
  const definitions = ['$org: String!']
  const selections: string[] = []
  const variables: Record<string, string | null> = { org }

  teams.forEach((team, index) => {
    definitions.push(`$slug${index}: String!`, `$cursor${index}: String`)
    variables[`slug${index}`] = team.slug
    variables[`cursor${index}`] = team.cursor
    selections.push(`
      team${index}: team(slug: $slug${index}) {
        members(first: 100, after: $cursor${index}, membership: ALL) {
          nodes { login }
          pageInfo { endCursor hasNextPage }
        }
      }`)
  })

  return {
    query: `query TeamFreezeGuardMembership(${definitions.join(', ')}) {
      organization(login: $org) {${selections.join('')}
      }
    }`,
    variables,
  }
}
