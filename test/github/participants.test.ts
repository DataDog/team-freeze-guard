import { describe, expect, it } from 'vitest'
import { resolveParticipants } from '../../src/github/participants'

interface CommitFixture {
  author: { login: string } | null
  committer: { login: string } | null
  commit: {
    author: { name: string } | null
    committer: { name: string } | null
  }
}

function fakeOctokit(commits: CommitFixture[], paginateCalls: unknown[][] = []) {
  const listCommits = Symbol('listCommits')
  return {
    rest: { pulls: { listCommits } },
    paginate: async (route: unknown, params: unknown) => {
      paginateCalls.push([route, params])
      return commits
    },
  } as unknown as Parameters<typeof resolveParticipants>[0]['octokit']
}

function commit(overrides: Partial<CommitFixture> = {}): CommitFixture {
  return {
    author: null,
    committer: null,
    commit: { author: null, committer: null },
    ...overrides,
  }
}

describe('resolveParticipants', () => {
  it('includes the PR author even with no commits', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result).toEqual({ logins: ['alice'], unmappedIdentities: [] })
  })

  it('collects GitHub-linked commit authors and committers across multiple commits', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({ author: { login: 'bob' }, committer: { login: 'bob' } }),
        commit({ author: { login: 'carol' }, committer: { login: 'dave' } }),
      ]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob', 'carol', 'dave'])
    expect(result.unmappedIdentities).toEqual([])
  })

  it('deduplicates repeated logins across commits and against the PR author', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({ author: { login: 'alice' }, committer: { login: 'alice' } }),
        commit({ author: { login: 'alice' }, committer: { login: 'bob' } }),
      ]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob'])
  })

  it('reports unmapped commit identities separately, not as participants', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({
          author: null,
          committer: { login: 'bob' },
          commit: { author: { name: 'Unmapped Author <a@example.com>' }, committer: null },
        }),
      ]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob'])
    expect(result.unmappedIdentities).toEqual(['Unmapped Author <a@example.com>'])
  })

  it('deduplicates repeated unmapped identities', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({ commit: { author: { name: 'Same Unmapped' }, committer: null } }),
        commit({ commit: { author: { name: 'Same Unmapped' }, committer: null } }),
      ]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.unmappedIdentities).toEqual(['Same Unmapped'])
  })

  it('fully consumes pagination by delegating to octokit.paginate', async () => {
    const paginateCalls: unknown[][] = []
    const octokit = fakeOctokit(
      [commit({ author: { login: 'bob' }, committer: { login: 'bob' } })],
      paginateCalls,
    )

    await resolveParticipants({
      octokit,
      owner: 'org',
      repo: 'repo',
      pullNumber: 42,
      prAuthorLogin: 'alice',
    })

    expect(paginateCalls).toHaveLength(1)
    expect(paginateCalls[0][1]).toEqual({ owner: 'org', repo: 'repo', pull_number: 42 })
  })
})
