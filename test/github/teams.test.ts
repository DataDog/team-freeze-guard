// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { resolveTeamMembership, TeamResolutionError } from '../../src/github/teams'

interface GraphqlCall {
  query: string
  variables: Record<string, string | null>
}

interface TeamPage {
  members: {
    nodes: Array<{ login: string } | null>
    pageInfo: { endCursor: string | null; hasNextPage: boolean }
  }
}

type GraphqlResponse = {
  organization: Record<string, TeamPage | null> | null
}

function page(logins: string[], hasNextPage = false, endCursor: string | null = null): TeamPage {
  return {
    members: {
      nodes: logins.map((login) => ({ login })),
      pageInfo: { endCursor, hasNextPage },
    },
  }
}

function fakeOctokit(
  responses: Array<GraphqlResponse | Error>,
  calls: GraphqlCall[] = [],
) {
  let index = 0
  return {
    graphql: async (query: string, variables: Record<string, string | null>) => {
      calls.push({ query, variables })
      const response = responses[index]
      index += 1
      if (response instanceof Error) {
        throw response
      }
      return response
    },
  } as Parameters<typeof resolveTeamMembership>[0]['octokit']
}

describe('resolveTeamMembership', () => {
  it('resolves every configured team in one GraphQL call', async () => {
    const calls: GraphqlCall[] = []
    const octokit = fakeOctokit(
      [
        {
          organization: {
            team0: page(['Alice']),
            team1: page(['bob', 'carol']),
          },
        },
      ],
      calls,
    )

    const result = await resolveTeamMembership({
      octokit,
      org: 'org',
      teamHandles: ['@org/team-a', '@org/team-b'],
    })

    expect(result).toEqual(
      new Map([
        ['@org/team-a', new Set(['alice'])],
        ['@org/team-b', new Set(['bob', 'carol'])],
      ]),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].query).toContain('team0: team(slug: $slug0)')
    expect(calls[0].query).toContain('team1: team(slug: $slug1)')
    expect(calls[0].variables).toMatchObject({
      org: 'org',
      slug0: 'team-a',
      slug1: 'team-b',
      cursor0: null,
      cursor1: null,
    })
  })

  it('fetches another batched page only when a team exceeds 100 members', async () => {
    const calls: GraphqlCall[] = []
    const firstPage = Array.from({ length: 100 }, (_, index) => `member-${String(index)}`)
    const octokit = fakeOctokit(
      [
        { organization: { team0: page(firstPage, true, 'next-page') } },
        { organization: { team0: page(['last-member']) } },
      ],
      calls,
    )

    const result = await resolveTeamMembership({
      octokit,
      org: 'org',
      teamHandles: ['@org/team-a'],
    })

    expect(result.get('@org/team-a')?.size).toBe(101)
    expect(result.get('@org/team-a')?.has('last-member')).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].variables.cursor0).toBe('next-page')
  })

  it('fails closed for an unknown or inaccessible organization', async () => {
    const octokit = fakeOctokit([{ organization: null }])

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow(TeamResolutionError)
  })

  it('fails closed for an unknown or inaccessible team', async () => {
    const octokit = fakeOctokit([{ organization: { team0: null } }])

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow('Team "@org/team-a" is unknown or inaccessible.')
  })

  it('fails closed when pagination metadata is incomplete', async () => {
    const octokit = fakeOctokit([
      { organization: { team0: page(['alice'], true, null) } },
    ])

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow('Team "@org/team-a" returned incomplete pagination data.')
  })

  it('wraps GraphQL and rate-limit failures', async () => {
    const octokit = fakeOctokit([new Error('secondary rate limit exceeded')])

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow('Failed to resolve frozen team membership.')
  })

  it('rejects a handle whose org does not match the resolved organization', async () => {
    const octokit = fakeOctokit([])

    await expect(
      resolveTeamMembership({
        octokit,
        org: 'org',
        teamHandles: ['@other-org/team-a'],
      }),
    ).rejects.toThrow(TeamResolutionError)
  })
})
