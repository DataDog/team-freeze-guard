// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveMembership, type ResolveMembershipInput } from '../src/resolve-team-membership'
import { FAIL_CLOSED_MESSAGE, type Reporter } from '../src/reporting'
import { readTeamMembershipFile } from '../src/team-membership-file'

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

function fakeOrgOctokit(membersByTeamSlug: Record<string, { login: string }[]>) {
  const listMembersInOrg = async (params: { team_slug: string }) => ({ data: membersByTeamSlug[params.team_slug] ?? [] })
  return {
    rest: { teams: { listMembersInOrg } },
    paginate: async (fn: typeof listMembersInOrg, params: { team_slug: string }) => (await fn(params)).data,
  } as unknown as ResolveMembershipInput['orgOctokit']
}

describe('resolveMembership', () => {
  let dir: string
  let outputPath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'team-freeze-guard-'))
    outputPath = join(dir, 'team-membership.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  function baseInput(overrides: Partial<ResolveMembershipInput> = {}): ResolveMembershipInput {
    return {
      frozenTeamsInput: '@org/team-a',
      repoOwner: 'org',
      orgOctokit: fakeOrgOctokit({ 'team-a': [] }),
      outputPath,
      reporter: fakeReporter(),
      ...overrides,
    }
  }

  it('writes the resolved membership of every configured frozen team to the output file', async () => {
    await resolveMembership(
      baseInput({
        frozenTeamsInput: '@org/team-a\n@org/team-b',
        orgOctokit: fakeOrgOctokit({ 'team-a': [{ login: 'bob' }], 'team-b': [{ login: 'carol' }] }),
      }),
    )

    const membership = await readTeamMembershipFile(outputPath)
    expect(membership).toEqual(
      new Map([
        ['@org/team-a', new Set(['bob'])],
        ['@org/team-b', new Set(['carol'])],
      ]),
    )
  })

  it('fails with the config error message, not a fail-closed wrapper, when frozen-teams is malformed', async () => {
    const reporter = fakeReporter()
    await resolveMembership(baseInput({ frozenTeamsInput: 'not-a-valid-handle', reporter }))

    expect(reporter.failures).toEqual([
      'frozen-teams entry "not-a-valid-handle" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".',
    ])
  })

  it('fails closed when team membership resolution throws', async () => {
    const reporter = fakeReporter()
    const orgOctokit = {
      rest: {
        teams: {
          listMembersInOrg: async () => {
            throw { status: 404 }
          },
        },
      },
      paginate: async (fn: () => Promise<unknown>) => fn(),
    } as unknown as ResolveMembershipInput['orgOctokit']

    await resolveMembership(baseInput({ orgOctokit, reporter }))

    expect(reporter.failures).toEqual([FAIL_CLOSED_MESSAGE])
    expect(reporter.summaries[0]).toContain('could not be evaluated safely')
  })

  it('logs only the error message, never a full stack trace, to avoid leaking internal detail into a possibly public Actions log', async () => {
    const reporter = fakeReporter()
    const orgOctokit = {
      rest: {
        teams: {
          listMembersInOrg: async () => {
            throw new Error('boom')
          },
        },
      },
      paginate: async (fn: () => Promise<unknown>) => fn(),
    } as unknown as ResolveMembershipInput['orgOctokit']

    await resolveMembership(baseInput({ orgOctokit, reporter }))

    expect(reporter.warnings).toEqual(['Failed to resolve members of team "@org/team-a".'])
  })
})
