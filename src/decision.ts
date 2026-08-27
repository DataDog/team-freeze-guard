export type DecisionOutcome = 'pass' | 'fail'

export interface Decision {
  outcome: DecisionOutcome
  matchedTeams: string[]
}

export interface DecisionInput {
  frozenTeams: string[]
  bypassLabels: string[]
  prLabels: string[]
  participants: string[]
  teamMembership: Map<string, Set<string>>
}

export function decide(input: DecisionInput): Decision {
  if (input.frozenTeams.length === 0) {
    return { outcome: 'pass', matchedTeams: [] }
  }

  const prLabels = new Set(input.prLabels)
  const hasBypassLabel = input.bypassLabels.some((label) => prLabels.has(label))
  if (hasBypassLabel) {
    return { outcome: 'pass', matchedTeams: [] }
  }

  const participants = new Set(input.participants)
  const matchedTeams = input.frozenTeams.filter((team) => {
    const members = input.teamMembership.get(team)
    if (!members) {
      return false
    }
    for (const participant of participants) {
      if (members.has(participant)) {
        return true
      }
    }
    return false
  })

  if (matchedTeams.length === 0) {
    return { outcome: 'pass', matchedTeams: [] }
  }

  return { outcome: 'fail', matchedTeams }
}
