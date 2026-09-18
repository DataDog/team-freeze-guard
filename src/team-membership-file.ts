// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { promises as fs } from 'node:fs'

export type TeamMembership = Map<string, Set<string>>

// The on-disk hand-off between the "Resolve frozen team membership" and "Evaluate
// team freeze policy" action steps. Kept as a plain JSON object (team handle ->
// sorted member logins) so a future PR can cache this file across runs.
export async function writeTeamMembershipFile(path: string, membership: TeamMembership): Promise<void> {
  const serializable: Record<string, string[]> = {}
  for (const [team, members] of membership) {
    serializable[team] = [...members].sort()
  }
  await fs.writeFile(path, JSON.stringify(serializable), 'utf8')
}

export async function readTeamMembershipFile(path: string): Promise<TeamMembership> {
  const raw = await fs.readFile(path, 'utf8')
  const parsed = JSON.parse(raw) as Record<string, string[]>
  return new Map(Object.entries(parsed).map(([team, members]) => [team, new Set(members)]))
}
