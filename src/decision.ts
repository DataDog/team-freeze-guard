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
  bypassTitlePattern?: string
  prLabels: string[]
  prTitle?: string
  participants: string[]
  teamMembership: Map<string, Set<string>>
}

export function hasBypassLabel(bypassLabels: string[], prLabels: string[]): boolean {
  const labels = new Set(prLabels)
  return bypassLabels.some((label) => labels.has(label))
}

export function matchesBypassTitlePattern(bypassTitlePattern: string, prTitle: string): boolean {
  return new RegExp(bypassTitlePattern).test(prTitle)
}

export type BypassMechanism = 'bypass-labels' | 'bypass-title-pattern'

export interface BypassCondition {
  mechanism: BypassMechanism
  // Whether this mechanism has a non-empty value configured. An unconfigured
  // mechanism is always reported as satisfied, since it does not gate the bypass.
  configured: boolean
  satisfied: boolean
}

export interface BypassEvaluationInput {
  bypassLabels: string[]
  bypassTitlePattern: string
  prLabels: string[]
  prTitle: string
}

// Evaluates each bypass mechanism independently, so callers can report exactly
// which configured mechanism(s) are satisfied and which are not.
export function evaluateBypassConditions(input: BypassEvaluationInput): BypassCondition[] {
  const labelsConfigured = input.bypassLabels.length > 0
  const titlePatternConfigured = input.bypassTitlePattern.length > 0

  return [
    {
      mechanism: 'bypass-labels',
      configured: labelsConfigured,
      satisfied: !labelsConfigured || hasBypassLabel(input.bypassLabels, input.prLabels),
    },
    {
      mechanism: 'bypass-title-pattern',
      configured: titlePatternConfigured,
      satisfied: !titlePatternConfigured || matchesBypassTitlePattern(input.bypassTitlePattern, input.prTitle),
    },
  ]
}

// A configured bypass mechanism (label or title pattern) must be satisfied when
// present; bypass mechanisms that are not configured are treated as satisfied,
// so a single configured mechanism can bypass on its own, but when several are
// configured, all of them must be satisfied.
export function shouldBypass(input: BypassEvaluationInput): boolean {
  const conditions = evaluateBypassConditions(input)
  return conditions.some((condition) => condition.configured) && conditions.every((condition) => condition.satisfied)
}

export function decide(input: DecisionInput): Decision {
  if (
    shouldBypass({
      bypassLabels: input.bypassLabels,
      bypassTitlePattern: input.bypassTitlePattern ?? '',
      prLabels: input.prLabels,
      prTitle: input.prTitle ?? '',
    })
  ) {
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
      if (members.has(participant.toLowerCase())) {
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
