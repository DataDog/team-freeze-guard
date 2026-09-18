// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { evaluate, type EvaluateInput, type PullRequestContext } from '../src/main'
import { FAIL_CLOSED_MESSAGE, type Reporter } from '../src/reporting'
import type { TeamMembership } from '../src/team-membership-file'

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

function teamMembership(membersByTeamHandle: Record<string, string[]>): TeamMembership {
  return new Map(Object.entries(membersByTeamHandle).map(([team, members]) => [team, new Set(members)]))
}

function pullRequest(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    authorLogin: 'alice',
    labels: [],
    title: 'Some PR title',
    ...overrides,
  }
}

function baseInput(overrides: Partial<EvaluateInput> = {}): EvaluateInput {
  return {
    bypassLabelsInput: 'ci-remediation',
    bypassTitlePatternInput: '',
    frozenMessageInput: 'Your team is frozen',
    pullRequest: pullRequest(),
    teamMembership: teamMembership({ '@org/team-a': [] }),
    reporter: fakeReporter(),
    ...overrides,
  }
}

describe('evaluate', () => {
  it('fails closed when there is no pull request context', async () => {
    const reporter = fakeReporter()
    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.summaries).toHaveLength(1)
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('passes on the bypass-label short-circuit', async () => {
    const reporter = fakeReporter()

    await evaluate(
      baseInput({
        pullRequest: pullRequest({ authorLogin: 'bob', labels: ['ci-remediation'] }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual([
      'The configured bypass conditions are satisfied; passing without evaluating participants.',
    ])
  })

  it('passes when the PR author does not belong to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        teamMembership: teamMembership({ '@org/team-a': ['carol'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([])
    expect(reporter.infos).toEqual(['No participant belongs to a frozen team; passing.'])
  })

  it('resolves membership independently across multiple frozen teams', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['carol'], '@org/team-b': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @bob belongs to frozen team @org/team-b. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.summaries[0]).toContain('- @bob belongs to frozen team @org/team-b.')
  })

  it('fails with a job summary matching the documented format when the PR author belongs to a frozen team', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @bob belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        '- @bob belongs to frozen team @org/team-a.',
        '',
        '- Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
      ].join('\n'),
    ])
  })

  it('still calls setFailed with the frozen message when writing the failure summary throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(
      baseInput({
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @bob belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.warnings).toEqual(['Failed to write the job summary: summary API unavailable'])
  })

  it('still calls setFailed with the frozen message when the fail-closed summary write throws', async () => {
    const reporter = fakeReporter()
    reporter.writeSummary = async () => {
      throw new Error('summary API unavailable')
    }

    await evaluate(baseInput({ pullRequest: undefined, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.warnings).toContain('Failed to write the job summary: summary API unavailable')
  })

  it('renders a meaningful remediation message when no bypass mechanisms are configured', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: '',
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Your team is frozen. - @bob belongs to frozen team @org/team-a. No bypass mechanism is configured for this repository; contact an administrator to proceed.',
    ])
    expect(reporter.summaries).toEqual([
      [
        'Your team is frozen.',
        '',
        '- @bob belongs to frozen team @org/team-a.',
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
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
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
        pullRequest: pullRequest({ authorLogin: 'bob', labels: ['hotfix'] }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
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
        pullRequest: pullRequest({ authorLogin: 'bob', labels: ['hotfix'], title: 'fix the thing' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )
    expect(reporter.failures).not.toEqual([])

    const passingReporter = fakeReporter()
    await evaluate(
      baseInput({
        bypassLabelsInput: 'hotfix',
        bypassTitlePatternInput: '^\\[hotfix\\]',
        pullRequest: pullRequest({ authorLogin: 'bob', labels: ['hotfix'], title: '[hotfix] fix the thing' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter: passingReporter,
      }),
    )
    expect(passingReporter.failures).toEqual([])
  })

  it('uses the configured frozen-message as the failure reason and summary heading', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenMessageInput: 'Merges are paused while the team is on-call',
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.failures).toEqual([
      'Merges are paused while the team is on-call. - @bob belongs to frozen team @org/team-a. - Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: `ci-remediation`.',
    ])
    expect(reporter.summaries[0]).toContain('Merges are paused while the team is on-call.')
  })

  it('does not double punctuation when the configured frozen-message already ends with it', async () => {
    const reporter = fakeReporter()
    await evaluate(
      baseInput({
        frozenMessageInput: 'Merges are paused!',
        pullRequest: pullRequest({ authorLogin: 'bob' }),
        teamMembership: teamMembership({ '@org/team-a': ['bob'] }),
        reporter,
      }),
    )

    expect(reporter.summaries[0]?.split('\n')[0]).toBe('Merges are paused!')
  })
})
