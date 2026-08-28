import { describe, expect, it, vi } from 'vitest'
import { evaluate, type EvaluateInput, type PullRequestContext, type Reporter } from '../src/main'

function fakeReporter(): Reporter & { summaries: string[]; failures: string[]; infos: string[]; warnings: string[] } {
  const summaries: string[] = []
  const failures: string[] = []
  const infos: string[] = []
  const warnings: string[] = []
  return {
    summaries,
    failures,
    infos,
    warnings,
    info: (message) => infos.push(message),
    warning: (message) => warnings.push(message),
    setFailed: (message) => failures.push(message),
    writeSummary: async (markdown) => {
      summaries.push(markdown)
    },
  }
}

function fakeOctokit(getCommitResult: unknown) {
  return {
    rest: {
      repos: {
        getCommit: async () => ({ data: getCommitResult }),
      },
    },
  } as unknown as EvaluateInput['octokit']
}

function fakeOrgOctokit(membersByTeamSlug: Record<string, { login: string }[]>) {
  const listMembersInOrg = async (params: { team_slug: string; page?: number }) => {
    if ((params.page ?? 1) > 1) {
      return { data: [] }
    }
    return { data: membersByTeamSlug[params.team_slug] ?? [] }
  }
  return {
    rest: {
      teams: { listMembersInOrg },
    },
    paginate: async (fn: typeof listMembersInOrg, params: { team_slug: string }) => {
      const { data } = await fn({ ...params, page: 1 })
      return data
    },
  } as unknown as EvaluateInput['octokit']
}

function pullRequest(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    authorLogin: 'alice',
    headSha: 'abc123',
    labels: [],
    ...overrides,
  }
}

function baseInput(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    bypassLabelsInput: 'ci-remediation',
    frozenTeamsInput: '@org/team-a',
    repoOwner: 'org',
    repoName: 'repo',
    pullRequest: pullRequest(),
    octokit: fakeOctokit({ committer: null, commit: { committer: null } }),
    orgOctokit: () => fakeOrgOctokit({ 'team-a': [] }),
    reporter: fakeReporter(),
    ...overrides,
  }
}

describe('evaluate', () => {
  it('fails closed with the config error message when config is malformed', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ frozenTeamsInput: 'not-a-valid-handle', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "not-a-valid-handle" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('passes immediately without calling any API when frozen-teams is empty', async () => {
    const reporter = fakeReporter()
    const octokit = vi.fn()
    // Constructing the org-scoped client requires exchanging an Octo STS
    // token, itself an external call, so the freeze-disabled path must never
    // even invoke this thunk. Throwing on invocation makes that assertion
    // stronger than a plain spy would: any use fails the test immediately.
    const orgOctokit = vi.fn(() => {
      throw new Error('should not construct the org-scoped client when frozen-teams is empty')
    })
    await evaluate(
      baseInput({
        frozenTeamsInput: '',
        reporter,
        octokit: octokit as unknown as EvaluateInput['octokit'],
        orgOctokit,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['No frozen teams are configured; passing.'])
    expect(orgOctokit).not.toHaveBeenCalled()
  })

  it('fails closed when there is no pull request context', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries).toHaveLength(1)
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('passes on the bypass-label short-circuit without resolving participants or teams', async () => {
    const reporter = fakeReporter()
    // The label check runs before team-membership resolution, so the
    // org-scoped client (and the Octo STS call needed to build it) must
    // never be constructed on this path either.
    const orgOctokit = vi.fn(() => {
      throw new Error('should not construct the org-scoped client on the bypass-label short-circuit')
    })

    await evaluate(
      baseInput({
        pullRequest: pullRequest({ labels: ['ci-remediation'] }),
        orgOctokit,
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['A configured bypass label is present; passing without evaluating participants.'])
    expect(orgOctokit).not.toHaveBeenCalled()
  })

  it('passes when no participant belongs to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        octokit: fakeOctokit({ committer: { login: 'bob' }, commit: { committer: null } }),
        orgOctokit: () => fakeOrgOctokit({ 'team-a': [{ login: 'carol' }] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['No participant belongs to a frozen team; passing.'])
  })

  it('fails with a job summary matching the documented format when a participant belongs to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        octokit: fakeOctokit({ committer: { login: 'bob' }, commit: { committer: null } }),
        orgOctokit: () => fakeOrgOctokit({ 'team-a': [{ login: 'bob' }] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        'At least one pull request participant belongs to @org/team-a.',
        'Add one of the following labels before merging this pull request: `ci-remediation`.',
      ].join('\n'),
    ])
  })

  it('warns on unmapped commit identities without failing the run', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        octokit: fakeOctokit({
          committer: null,
          commit: { committer: { name: 'Unmapped Person', email: 'a@example.com' } },
        }),
        orgOctokit: () => fakeOrgOctokit({ 'team-a': [] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.warnings).toEqual([
      'Could not map commit identity "Unmapped Person <a@example.com>" to a GitHub account; it was not checked against frozen teams.',
    ])
  })

  it('fails closed when team membership resolution throws', async () => {
    const reporter = fakeReporter()
    const orgOctokit = () =>
      ({
        rest: {
          teams: {
            listMembersInOrg: async () => {
              throw { status: 404 }
            },
          },
        },
        paginate: async (fn: () => Promise<unknown>) => fn(),
      }) as unknown as ReturnType<EvaluateInput['orgOctokit']>

    await evaluate(baseInput({ orgOctokit, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('fails closed when participant resolution throws', async () => {
    const reporter = fakeReporter()
    const octokit = {
      rest: {
        repos: {
          getCommit: async () => {
            throw new Error('boom')
          },
        },
      },
    } as unknown as EvaluateInput['octokit']

    await evaluate(baseInput({ octokit, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('logs only the error message, never a full stack trace, to avoid leaking internal detail into a possibly public Actions log', async () => {
    const reporter = fakeReporter()
    const octokit = {
      rest: {
        repos: {
          getCommit: async () => {
            throw new Error('boom')
          },
        },
      },
    } as unknown as EvaluateInput['octokit']

    await evaluate(baseInput({ octokit, reporter }))

    expect(reporter.warnings).toEqual(['boom'])
  })

  it('logs a non-Error throwable as readable JSON instead of "[object Object]"', async () => {
    const reporter = fakeReporter()
    const octokit = {
      rest: {
        repos: {
          getCommit: async () => {
            throw { status: 404, message: 'Not Found' }
          },
        },
      },
    } as unknown as EvaluateInput['octokit']

    await evaluate(baseInput({ octokit, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.warnings).toEqual([JSON.stringify({ status: 404, message: 'Not Found' })])
  })

  it('fails closed with a config error when frozen-teams is the action.yml "not set" sentinel', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ frozenTeamsInput: '__frozen-teams-not-set__', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "__frozen-teams-not-set__" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('still calls setFailed with the frozen message when writing the failure summary throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(
      baseInput({
        octokit: fakeOctokit({ committer: { login: 'bob' }, commit: { committer: null } }),
        orgOctokit: () => fakeOrgOctokit({ 'team-a': [{ login: 'bob' }] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.warnings).toEqual(['Failed to write the job summary: summary API unavailable'])
  })

  it('still calls setFailed with the frozen message when the fail-closed summary write throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.warnings).toContain('Failed to write the job summary: summary API unavailable')
  })

  it('renders a meaningful remediation message when no bypass labels are configured', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: '',
        octokit: fakeOctokit({ committer: { login: 'bob' }, commit: { committer: null } }),
        orgOctokit: () => fakeOrgOctokit({ 'team-a': [{ login: 'bob' }] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        'At least one pull request participant belongs to @org/team-a.',
        'No bypass labels are configured for this repository; contact an administrator to proceed.',
      ].join('\n'),
    ])
  })
})
