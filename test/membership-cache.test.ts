// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import {
  MembershipCacheError,
  parseMembershipSnapshot,
  serializeMembershipSnapshot,
} from '../src/membership-cache'

const GENERATED_AT = new Date('2026-09-10T12:00:00.000Z')

describe('membership cache', () => {
  it('round-trips memberships and normalizes logins', () => {
    const serialized = serializeMembershipSnapshot(
      new Map([['@org/team-a', new Set(['Alice', 'bob'])]]),
      GENERATED_AT,
    )

    expect(
      parseMembershipSnapshot(serialized, ['@org/team-a'], GENERATED_AT),
    ).toEqual(new Map([['@org/team-a', new Set(['alice', 'bob'])]]))
  })

  it('rejects unsupported schemas', () => {
    const serialized = JSON.stringify({
      schemaVersion: 2,
      generatedAt: GENERATED_AT.toISOString(),
      teams: { '@org/team-a': [] },
    })

    expect(() =>
      parseMembershipSnapshot(serialized, ['@org/team-a'], GENERATED_AT),
    ).toThrow(MembershipCacheError)
  })

  it('rejects a generation time too far in the future', () => {
    const serialized = serializeMembershipSnapshot(
      new Map([['@org/team-a', new Set<string>()]]),
      new Date('2026-09-10T12:06:00.000Z'),
    )

    expect(() =>
      parseMembershipSnapshot(serialized, ['@org/team-a'], GENERATED_AT),
    ).toThrow('Membership cache generation time is in the future.')
  })

  it('rejects invalid member entries', () => {
    const serialized = JSON.stringify({
      schemaVersion: 1,
      generatedAt: GENERATED_AT.toISOString(),
      teams: { '@org/team-a': ['alice', ''] },
    })

    expect(() =>
      parseMembershipSnapshot(serialized, ['@org/team-a'], GENERATED_AT),
    ).toThrow('Membership cache entry for "@org/team-a" is invalid.')
  })
})
