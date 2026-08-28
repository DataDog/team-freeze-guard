import { describe, expect, it, vi } from 'vitest'
import { evaluate, type EvaluateInput, type PullRequestContext } from '../src/main'
import type { Reporter } from '../src/reporting'

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
    teamMembership: new Map([['@org/team-a', new Set<string>()]]),
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

  it('fails closed when there is no pull request context', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries).toHaveLength(1)
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('passes on the bypass-label short-circuit without resolving participants', async () => {
    const reporter = fakeReporter()
    // The label check runs before participant resolution, so the GITHUB_TOKEN-scoped
    // client must never be called on this path either.
    const getCommit = vi.fn(async () => {
      throw new Error('should not resolve participants on the bypass-label short-circuit')
    })
    const octokit = { rest: { repos: { getCommit } } } as unknown as EvaluateInput['octokit']

    await evaluate(
      baseInput({
        pullRequest: pullRequest({ labels: ['ci-remediation'] }),
        octokit,
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['A configured bypass label is present; passing without evaluating participants.'])
    expect(getCommit).not.toHaveBeenCalled()
  })

  it('passes when no participant belongs to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        octokit: fakeOctokit({ committer: { login: 'bob' }, commit: { committer: null } }),
        teamMembership: new Map([['@org/team-a', new Set(['carol'])]]),
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
        teamMembership: new Map([['@org/team-a', new Set(['bob'])]]),
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
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.warnings).toEqual([
      'Could not map commit identity "Unmapped Person <a@example.com>" to a GitHub account; it was not checked against frozen teams.',
    ])
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
        teamMembership: new Map([['@org/team-a', new Set(['bob'])]]),
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
        teamMembership: new Map([['@org/team-a', new Set(['bob'])]]),
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
