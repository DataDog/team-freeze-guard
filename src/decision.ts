// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

export type DecisionOutcome = 'pass' | 'fail'

export interface Match {
  participant: string
  team: string
}

export interface Decision {
  outcome: DecisionOutcome
  matchedTeams: string[]
  matches: Match[]
}

export interface DecisionInput {
  frozenTeams: string[]
  bypassLabels: string[]
  prLabels: string[]
  participants: string[]
  teamMembership: Map<string, Set<string>>
}

export function hasBypassLabel(bypassLabels: string[], prLabels: string[]): boolean {
  const labels = new Set(prLabels)
  return bypassLabels.some((label) => labels.has(label))
}

export function decide(input: DecisionInput): Decision {
  if (hasBypassLabel(input.bypassLabels, input.prLabels)) {
    return { outcome: 'pass', matchedTeams: [], matches: [] }
  }

  const participants = new Set(input.participants)
  const matches: Match[] = []
  const matchedTeams = input.frozenTeams.filter((team) => {
    const members = input.teamMembership.get(team)
    if (!members) {
      return false
    }
    let matched = false
    for (const participant of participants) {
      if (members.has(participant)) {
        matches.push({ participant, team })
        matched = true
      }
    }
    return matched
  })

  if (matchedTeams.length === 0) {
    return { outcome: 'pass', matchedTeams: [], matches: [] }
  }

  return { outcome: 'fail', matchedTeams, matches }
}
