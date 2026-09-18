// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readTeamMembershipFile, writeTeamMembershipFile } from '../src/team-membership-file'

describe('team membership file', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'team-freeze-guard-'))
    filePath = join(dir, 'team-membership.json')
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('round-trips membership across multiple teams', async () => {
    const membership = new Map([
      ['@org/team-a', new Set(['bob', 'carol'])],
      ['@org/team-b', new Set<string>()],
    ])

    await writeTeamMembershipFile(filePath, membership)
    const result = await readTeamMembershipFile(filePath)

    expect(result).toEqual(membership)
  })

  it('writes deterministically sorted, plain JSON so the file is stable for future caching', async () => {
    await writeTeamMembershipFile(filePath, new Map([['@org/team-a', new Set(['carol', 'bob'])]]))

    const raw = await readFile(filePath, 'utf8')

    expect(raw).toBe(JSON.stringify({ '@org/team-a': ['bob', 'carol'] }))
  })
})
