import { describe, expect, it, vi } from 'vitest'
import { resolveAndOutputTeamMembership, type ResolveTeamMembershipStepInput } from '../src/resolveTeamMembership'
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

function fakeOctokit(membersByTeamSlug: Record<string, { login: string }[]>) {
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
  } as unknown as ResolveTeamMembershipStepInput['octokit']
}

function baseInput(overrides: Partial<ResolveTeamMembershipStepInput> = {}): ResolveTeamMembershipStepInput {
  return {
    bypassLabelsInput: 'ci-remediation',
    frozenTeamsInput: '@org/team-a',
    repoOwner: 'org',
    octokit: fakeOctokit({ 'team-a': [] }),
    reporter: fakeReporter(),
    setOutput: vi.fn(),
    ...overrides,
  }
}

describe('resolveAndOutputTeamMembership', () => {
  it('fails closed with the config error message when config is malformed', async () => {
    const reporter = fakeReporter()
    await resolveAndOutputTeamMembership(baseInput({ frozenTeamsInput: 'not-a-valid-handle', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "not-a-valid-handle" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('fails closed with a config error when frozen-teams is the action.yml "not set" sentinel', async () => {
    const reporter = fakeReporter()
    await resolveAndOutputTeamMembership(baseInput({ frozenTeamsInput: '__frozen-teams-not-set__', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "__frozen-teams-not-set__" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('sets the team-membership output as JSON keyed by the "@org/team-slug" handle', async () => {
    const setOutput = vi.fn()
    await resolveAndOutputTeamMembership(
      baseInput({
        frozenTeamsInput: '@org/team-a\n@org/team-b',
        octokit: fakeOctokit({ 'team-a': [{ login: 'alice' }, { login: 'bob' }], 'team-b': [{ login: 'carol' }] }),
        setOutput,
      }),
    )

    expect(setOutput).toHaveBeenCalledWith(
      'team-membership',
      JSON.stringify({ '@org/team-a': ['alice', 'bob'], '@org/team-b': ['carol'] }),
    )
  })

  it('fails closed when team membership resolution throws', async () => {
    const reporter = fakeReporter()
    const octokit = {
      rest: {
        teams: {
          listMembersInOrg: async () => {
            throw { status: 404 }
          },
        },
      },
      paginate: async (fn: () => Promise<unknown>) => fn(),
    } as unknown as ResolveTeamMembershipStepInput['octokit']

    await resolveAndOutputTeamMembership(baseInput({ octokit, reporter }))

    expect(reporter.failures).toEqual(['Your team is frozen'])
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('does not set an output when config is malformed', async () => {
    const setOutput = vi.fn()
    await resolveAndOutputTeamMembership(baseInput({ frozenTeamsInput: 'not-a-valid-handle', setOutput }))

    expect(setOutput).not.toHaveBeenCalled()
  })
})
