// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

export const MEMBERSHIP_CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1000
const SCHEMA_VERSION = 1
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000

interface MembershipSnapshot {
  schemaVersion: number
  generatedAt: string
  teams: Record<string, string[]>
}

export class MembershipCacheError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MembershipCacheError'
  }
}

export function serializeMembershipSnapshot(
  membership: Map<string, Set<string>>,
  generatedAt = new Date(),
): string {
  const teams = Object.fromEntries(
    [...membership.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([team, members]) => [
        team,
        [...new Set([...members].map((login) => login.toLowerCase()))].sort(),
      ]),
  )

  return `${JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    teams,
  })}\n`
}

export function parseMembershipSnapshot(
  raw: string,
  expectedTeams: string[],
  now = new Date(),
): Map<string, Set<string>> {
  const snapshot = parseSnapshotJson(raw)
  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new MembershipCacheError(
      `Membership cache schema ${String(snapshot.schemaVersion)} is unsupported.`,
    )
  }

  validateGeneratedAt(snapshot.generatedAt, now)
  validateTeamKeys(snapshot.teams, expectedTeams)

  return new Map(
    expectedTeams.map((team) => {
      const members = snapshot.teams[team]
      if (!Array.isArray(members) || members.some((login) => !isNonEmptyString(login))) {
        throw new MembershipCacheError(`Membership cache entry for "${team}" is invalid.`)
      }
      return [team, new Set(members.map((login) => login.toLowerCase()))]
    }),
  )
}

function parseSnapshotJson(raw: string): MembershipSnapshot {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new MembershipCacheError('Membership cache is not valid JSON.', { cause: error })
  }

  if (!isRecord(value) || !isRecord(value.teams) || typeof value.generatedAt !== 'string') {
    throw new MembershipCacheError('Membership cache has an invalid structure.')
  }

  return value as unknown as MembershipSnapshot
}

function validateGeneratedAt(generatedAt: string, now: Date): void {
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) {
    throw new MembershipCacheError('Membership cache has an invalid generation time.')
  }
  if (timestamp > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new MembershipCacheError('Membership cache generation time is in the future.')
  }
  if (now.getTime() - timestamp > MEMBERSHIP_CACHE_MAX_AGE_MS) {
    throw new MembershipCacheError('Membership cache is stale; run its refresh workflow.')
  }
}

function validateTeamKeys(teams: Record<string, unknown>, expectedTeams: string[]): void {
  const actual = Object.keys(teams).sort()
  const expected = [...expectedTeams].sort()
  if (actual.length !== expected.length || actual.some((team, index) => team !== expected[index])) {
    throw new MembershipCacheError('Membership cache does not match the configured frozen teams.')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}
