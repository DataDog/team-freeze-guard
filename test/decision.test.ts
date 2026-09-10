// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { decide } from '../src/decision'

describe('decide', () => {
  it('passes when there are no frozen teams', () => {
    const result = decide({
      frozenTeams: [],
      bypassLabels: ['hotfix'],
      prLabels: [],
      participants: ['alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })

  it('passes when no participant belongs to a frozen team', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: [],
      prLabels: [],
      participants: ['bob'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })

  it('fails when a participant belongs to a frozen team and no bypass label is present', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: ['hotfix'],
      prLabels: [],
      participants: ['alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({
      outcome: 'fail',
      matchedTeams: ['@org/team-a'],
      matches: [{ participant: 'alice', team: '@org/team-a' }],
    })
  })

  it('passes when a bypass label is present, even with a matching participant', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: ['hotfix'],
      prLabels: ['hotfix'],
      participants: ['alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })

  it('does not consult teamMembership at all when a bypass label short-circuits', () => {
    const poisonedTeamMembership = {
      get(): never {
        throw new Error('teamMembership should not be consulted when a bypass label matches')
      },
    } as unknown as Map<string, Set<string>>

    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: ['hotfix'],
      prLabels: ['hotfix'],
      participants: ['alice'],
      teamMembership: poisonedTeamMembership,
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })

  it('requires an exact case match on labels', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: ['Hotfix'],
      prLabels: ['HOTFIX'],
      participants: ['alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({
      outcome: 'fail',
      matchedTeams: ['@org/team-a'],
      matches: [{ participant: 'alice', team: '@org/team-a' }],
    })
  })

  it('any-matches across multiple bypass labels', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: ['hotfix', 'ci-remediation'],
      prLabels: ['ci-remediation'],
      participants: ['alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })

  it('any-matches across multiple frozen teams, reporting every matched team', () => {
    const result = decide({
      frozenTeams: ['@org/team-a', '@org/team-b'],
      bypassLabels: ['hotfix'],
      prLabels: [],
      participants: ['alice'],
      teamMembership: new Map([
        ['@org/team-a', new Set(['alice'])],
        ['@org/team-b', new Set(['alice', 'bob'])],
      ]),
    })

    expect(result.outcome).toBe('fail')
    expect(result.matchedTeams.sort()).toEqual(['@org/team-a', '@org/team-b'])
  })

  it('reports only the frozen teams that actually matched, not every frozen team', () => {
    const result = decide({
      frozenTeams: ['@org/team-a', '@org/team-b'],
      bypassLabels: [],
      prLabels: [],
      participants: ['alice'],
      teamMembership: new Map([
        ['@org/team-a', new Set(['alice'])],
        ['@org/team-b', new Set(['bob'])],
      ]),
    })

    expect(result).toEqual({
      outcome: 'fail',
      matchedTeams: ['@org/team-a'],
      matches: [{ participant: 'alice', team: '@org/team-a' }],
    })
  })

  it('any-matches across multiple participants against a single team', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: [],
      prLabels: [],
      participants: ['bob', 'alice'],
      teamMembership: new Map([['@org/team-a', new Set(['alice'])]]),
    })

    expect(result).toEqual({
      outcome: 'fail',
      matchedTeams: ['@org/team-a'],
      matches: [{ participant: 'alice', team: '@org/team-a' }],
    })
  })

  it('passes when a frozen team has no resolved membership entry', () => {
    const result = decide({
      frozenTeams: ['@org/team-a'],
      bypassLabels: [],
      prLabels: [],
      participants: ['alice'],
      teamMembership: new Map(),
    })

    expect(result).toEqual({ outcome: 'pass', matchedTeams: [], matches: [] })
  })
})
