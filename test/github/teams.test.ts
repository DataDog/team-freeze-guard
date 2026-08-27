import { describe, expect, it } from 'vitest'
import { resolveTeamMembership, TeamResolutionError } from '../../src/github/teams'

interface ListMembersParams {
  org: string
  team_slug: string
  per_page?: number
  page?: number
}

type TeamPages = Record<string, Array<{ login: string }[]> | { status: number } | Error>

function fakeOctokit(teamPages: TeamPages, calls: ListMembersParams[] = []) {
  const listMembersInOrg = async (params: ListMembersParams) => {
    calls.push(params)
    const result = teamPages[params.team_slug]
    if (result instanceof Error || (result && 'status' in result && !Array.isArray(result))) {
      throw result
    }
    const pages = result as Array<{ login: string }[]>
    const page = params.page ?? 1
    return { data: pages[page - 1] ?? [] }
  }

  return {
    rest: {
      teams: { listMembersInOrg },
    },
    paginate: async (fn: typeof listMembersInOrg, params: ListMembersParams) => {
      const results: { login: string }[] = []
      let page = 1
      const perPage = params.per_page ?? 100
      for (;;) {
        const { data } = await fn({ ...params, page })
        results.push(...data)
        if (data.length < perPage) {
          break
        }
        page += 1
      }
      return results
    },
  } as unknown as Parameters<typeof resolveTeamMembership>[0]['octokit']
}

function membersPage(count: number, prefix: string): { login: string }[] {
  return Array.from({ length: count }, (_, index) => ({ login: `${prefix}${index}` }))
}

describe('resolveTeamMembership', () => {
  it('resolves the members of a single team, keyed by the "@org/team-slug" handle', async () => {
    const octokit = fakeOctokit({ 'team-a': [[{ login: 'alice' }, { login: 'bob' }]] })

    const result = await resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] })

    expect(result).toEqual(new Map([['@org/team-a', new Set(['alice', 'bob'])]]))
  })

  it('resolves the members of multiple teams independently', async () => {
    const octokit = fakeOctokit({
      'team-a': [[{ login: 'alice' }]],
      'team-b': [[{ login: 'bob' }, { login: 'carol' }]],
    })

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
  })

  it('calls the GitHub API with the bare team slug, not the "@org/" handle', async () => {
    const calls: ListMembersParams[] = []
    const octokit = fakeOctokit({ 'team-a': [[{ login: 'alice' }]] }, calls)

    await resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] })

    expect(calls[0]).toMatchObject({ org: 'org', team_slug: 'team-a' })
  })

  it('fully consumes a paginated member list', async () => {
    const fullPage = membersPage(100, 'member-')
    const lastPage = [{ login: 'last-member' }]
    const octokit = fakeOctokit({ 'team-a': [fullPage, lastPage] })

    const result = await resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] })

    expect(result.get('@org/team-a')?.size).toBe(101)
    expect(result.get('@org/team-a')?.has('last-member')).toBe(true)
  })

  it('fails closed with a TeamResolutionError for an unknown team (404)', async () => {
    const octokit = fakeOctokit({ 'team-a': { status: 404 } })

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow(TeamResolutionError)
  })

  it('fails closed with a TeamResolutionError for an inaccessible team (403)', async () => {
    const octokit = fakeOctokit({ 'team-a': { status: 403 } })

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow(TeamResolutionError)
  })

  it('fails closed with a TeamResolutionError on a generic HTTP failure (500)', async () => {
    const octokit = fakeOctokit({ 'team-a': { status: 500 } })

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow(TeamResolutionError)
  })

  it('fails closed with a TeamResolutionError on a rate-limited/non-HTTP failure', async () => {
    const octokit = fakeOctokit({ 'team-a': new Error('secondary rate limit exceeded') })

    await expect(
      resolveTeamMembership({ octokit, org: 'org', teamHandles: ['@org/team-a'] }),
    ).rejects.toThrow(TeamResolutionError)
  })
})
