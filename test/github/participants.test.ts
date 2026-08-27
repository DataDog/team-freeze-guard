import { describe, expect, it } from 'vitest'
import { resolveParticipants } from '../../src/github/participants'

interface CommitFixture {
  committer: { login: string } | null
  commit: {
    committer: { name: string; email: string } | null
  }
}

function fakeOctokit(commit: CommitFixture, getCommitCalls: unknown[][] = []) {
  return {
    rest: {
      repos: {
        getCommit: async (params: unknown) => {
          getCommitCalls.push([params])
          return { data: commit }
        },
      },
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
  it('includes the PR author alongside the head commit committer', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit(commit({ committer: { login: 'bob' } })),
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      prAuthorLogin: 'alice',
    })

    expect(result.logins.sort()).toEqual(['alice', 'bob'])
    expect(result.unmappedIdentities).toEqual([])
  })

  it('deduplicates when the head committer is the same as the PR author', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit(commit({ committer: { login: 'alice' } })),
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      prAuthorLogin: 'alice',
    })

    expect(result.logins).toEqual(['alice'])
  })

  it('reports an unmapped head committer identity as name and email, not as a participant', async () => {
    const result = await resolveParticipants({
      octokit: fakeOctokit(
        commit({
          committer: null,
          commit: { committer: { name: 'Unmapped Committer', email: 'a@example.com' } },
        }),
      ),
      owner: 'org',
      repo: 'repo',
      headSha: 'abc123',
      prAuthorLogin: 'alice',
    })

    expect(result.logins).toEqual(['alice'])
    expect(result.unmappedIdentities).toEqual(['Unmapped Committer <a@example.com>'])
  })

  it('fetches only the pull request head commit, not the full commit history', async () => {
    const getCommitCalls: unknown[][] = []
    const octokit = fakeOctokit(commit({ committer: { login: 'bob' } }), getCommitCalls)

    await resolveParticipants({
      octokit,
      owner: 'org',
      repo: 'repo',
      headSha: 'deadbeef',
      prAuthorLogin: 'alice',
    })

    expect(getCommitCalls).toEqual([[{ owner: 'org', repo: 'repo', ref: 'deadbeef' }]])
  })
})
