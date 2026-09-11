// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import {
  evaluate,
  refreshMembership,
  type EvaluateInput,
  type PullRequestContext,
  type RefreshInput,
} from '../src/main'
import { parseMembershipSnapshot, serializeMembershipSnapshot } from '../src/membership-cache'
import { FAIL_CLOSED_MESSAGE, type Reporter } from '../src/reporting'

const NOW = new Date('2026-09-10T12:00:00.000Z')

interface FakeReporter extends Reporter {
  summaries: string[]
  failures: string[]
  infos: string[]
  warnings: string[]
}

function fakeReporter(): FakeReporter {
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

function pullRequest(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    authorLogin: 'alice',
    labels: [],
    title: 'Some PR title',
    ...overrides,
  }
}

function snapshot(entries: Array<[string, string[]]>): string {
  return serializeMembershipSnapshot(
    new Map(entries.map(([team, members]) => [team, new Set(members)])),
    NOW,
  )
}

function baseInput(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    bypassLabelsInput: 'ci-remediation',
    bypassTitlePatternInput: '',
    frozenTeamsInput: '@org/team-a',
    frozenMessageInput: 'Your team is frozen',
    repoOwner: 'org',
    pullRequest: pullRequest(),
    readMembershipSnapshot: () => snapshot([['@org/team-a', []]]),
    now: NOW,
    reporter: fakeReporter(),
    ...overrides,
  }
}

describe('evaluate', () => {
  it('passes an empty frozen-team list without reading membership', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenTeamsInput: '',
        pullRequest: undefined,
        readMembershipSnapshot: () => {
          throw new Error('should not read membership when no team is frozen')
        },
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['No frozen teams configured; passing.'])
  })

  it('fails closed with the config error message when config is malformed', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ frozenTeamsInput: 'not-a-valid-handle', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "not-a-valid-handle" is not a valid GitHub team slug. ' +
        'Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('fails closed when there is no pull request context', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('passes a bypass label without reading a valid membership cache', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        pullRequest: pullRequest({ labels: ['ci-remediation'] }),
        readMembershipSnapshot: () => {
          throw new Error('should not read membership on the bypass-label short-circuit')
        },
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual([
      'The configured bypass conditions are satisfied; passing without evaluating the pull request author.',
    ])
  })

  it('passes when the pull request author does not belong to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['bob']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual([
      'The pull request author does not belong to a frozen team; passing.',
    ])
  })

  it('does not consider other contributors when the author is not frozen', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () =>
          snapshot([['@org/team-a', ['would-be-committer']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
  })

  it('matches the author case-insensitively across multiple teams', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenTeamsInput: '@org/team-a\n@org/team-b',
        pullRequest: pullRequest({ authorLogin: 'Alice' }),
        readMembershipSnapshot: () => snapshot([
          ['@org/team-a', ['carol']],
          ['@org/team-b', ['ALICE']],
        ]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @Alice belongs to frozen team @org/team-b. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
  })

  it('writes the documented failure summary for a frozen author', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @alice belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        '- @alice belongs to frozen team @org/team-a.',
        '',
        '- Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
      ].join('\n'),
    ])
  })

  it('fails closed when the membership cache is malformed', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ readMembershipSnapshot: () => 'not JSON', reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toEqual(['Membership cache is not valid JSON.'])
  })

  it('logs only an error message, never its stack trace', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () => {
          throw new Error('boom')
        },
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toEqual(['boom'])
  })

  it('logs a non-Error throwable as readable JSON', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () => {
          throw { status: 404, message: 'Not Found' }
        },
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toEqual([
      JSON.stringify({ status: 404, message: 'Not Found' }),
    ])
  })

  it('fails with a config error for the action.yml "not set" sentinel', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenTeamsInput: '__frozen-teams-not-set__',
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'frozen-teams entry "__frozen-teams-not-set__" is not a valid GitHub team slug. ' +
        'Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('fails closed when the cached teams do not match configuration', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        readMembershipSnapshot: () => snapshot([['@org/team-b', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toEqual([
      'Membership cache does not match the configured frozen teams.',
    ])
  })

  it('fails closed when the membership cache is stale', async () => {
    const reporter = fakeReporter()
    const stale = serializeMembershipSnapshot(
      new Map([['@org/team-a', new Set(['alice'])]]),
      new Date('2026-09-10T08:59:59.000Z'),
    )
    await evaluate(baseInput({ readMembershipSnapshot: () => stale, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toEqual([
      'Membership cache is stale; run its refresh workflow.',
    ])
  })

  it('still fails when writing the policy-denial summary throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(
      baseInput({
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @alice belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.warnings).toEqual([
      'Failed to write the job summary: summary API unavailable',
    ])
  })

  it('still fails when writing the fail-closed summary throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toContain(
      'Failed to write the job summary: summary API unavailable',
    )
  })

  it('renders a meaningful remediation message when no bypass mechanisms are configured', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: '',
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @alice belongs to frozen team @org/team-a. No bypass mechanism is configured for this repository; contact an administrator to proceed.',
    ])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        '- @alice belongs to frozen team @org/team-a.',
        '',
        'No bypass mechanism is configured for this repository; contact an administrator to proceed.',
      ].join('\n'),
    ])
  })

  it('reports one line per configured bypass mechanism, each with its own result, when neither is satisfied', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: 'hotfix',
        bypassTitlePatternInput: '^\\[hotfix\\]',
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.summaries[0]).toContain(
      '- Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `hotfix`.',
    )
    expect(reporter.summaries[0]).toContain(
      '- Bypass title pattern: not satisfied — if your PR is meant to fix the freeze root cause, please correct the PR title to match `^\\[hotfix\\]`.',
    )
  })

  it('reports a configured bypass mechanism as satisfied even when the overall decision still fails', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: 'hotfix',
        bypassTitlePatternInput: '^\\[hotfix\\]',
        pullRequest: pullRequest({ labels: ['hotfix'] }),
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.summaries[0]).toContain('- Bypass label: satisfied.')
    expect(reporter.summaries[0]).toContain(
      '- Bypass title pattern: not satisfied — if your PR is meant to fix the freeze root cause, please correct the PR title to match `^\\[hotfix\\]`.',
    )
  })

  it('passes only when both a bypass label and a matching PR title are present, when both are configured', async () => {
    const reporter = fakeReporter()

    await evaluate(
      baseInput({
        bypassLabelsInput: 'hotfix',
        bypassTitlePatternInput: '^\\[hotfix\\]',
        pullRequest: pullRequest({ labels: ['hotfix'], title: 'fix the thing' }),
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )
    expect(reporter.failures).not.toEqual([])

    const passingReporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: 'hotfix',
        bypassTitlePatternInput: '^\\[hotfix\\]',
        pullRequest: pullRequest({ labels: ['hotfix'], title: '[hotfix] fix the thing' }),
        reporter: passingReporter,
      }),
    )
    expect(passingReporter.failures).toEqual([])
  })

  it('uses the configured frozen message as the failure reason', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenMessageInput: 'Merges are paused while the team is on-call',
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Merges are paused while the team is on-call. - @alice belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.summaries[0]).toContain('Merges are paused while the team is on-call.')
  })

  it('does not double punctuation in the configured frozen message', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenMessageInput: 'Merges are paused!',
        readMembershipSnapshot: () => snapshot([['@org/team-a', ['alice']]]),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Merges are paused! - @alice belongs to frozen team @org/team-a. ' +
        '- Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, ' +
        'please add one of these labels: `ci-remediation`.',
    ])
  })
})

describe('refreshMembership', () => {
  it('queries and serializes configured team membership', async () => {
    const reporter = fakeReporter()
    let written = ''
    const orgOctokit = {
      graphql: async () => ({
        organization: {
          team0: {
            members: {
              nodes: [{ login: 'Alice' }],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        },
      }),
    } as unknown as RefreshInput['orgOctokit']

    await refreshMembership({
      frozenTeamsInput: '@org/team-a',
      repoOwner: 'org',
      orgOctokit,
      generatedAt: NOW,
      writeSnapshot: (value) => {
        written = value
      },
      reporter,
    })

    expect(parseMembershipSnapshot(written, ['@org/team-a'], NOW)).toEqual(
      new Map([['@org/team-a', new Set(['alice'])]]),
    )
    expect(reporter.infos).toEqual(['Resolved and cached membership for 1 team(s).'])
  })
})
