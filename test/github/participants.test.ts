import { describe, expect, it } from 'vitest'
import { resolveParticipants } from '../../src/github/participants'

interface CommitFixture {
  committer: { login: string } | null
  commit: {
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
    committer: null,
    commit: { committer: null },
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

  it('collects GitHub-linked commit committers across multiple commits', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([commit({ committer: { login: 'bob' } }), commit({ committer: { login: 'dave' } })]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob', 'dave'])
    expect(result.unmappedIdentities).toEqual([])
  })

  it('deduplicates repeated committer logins across commits and against the PR author', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([commit({ committer: { login: 'alice' } }), commit({ committer: { login: 'bob' } })]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob'])
  })

  it('reports unmapped committer identities separately, not as participants', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({
          committer: null,
          commit: { committer: { name: 'Unmapped Committer <a@example.com>' } },
        }),
      ]),
      owner: 'org',
      repo: 'repo',
      pullNumber: 1,
      prAuthorLogin: 'alice',
    })

    expect(result.logins).toEqual(['alice'])
    expect(result.unmappedIdentities).toEqual(['Unmapped Committer <a@example.com>'])
  })

  it('deduplicates repeated unmapped identities', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit([
        commit({ commit: { committer: { name: 'Same Unmapped' } } }),
        commit({ commit: { committer: { name: 'Same Unmapped' } } }),
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
    const octokit = fakeOctokit([commit({ committer: { login: 'bob' } })], paginateCalls)

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
