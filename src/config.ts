export interface Config {
  bypassLabels: string[]
  frozenTeams: string[]
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface ParseConfigInput {
  bypassLabels: string | undefined
  frozenTeams: string | undefined
  repoOwner: string
}

const TEAM_ENTRY_PATTERN = /^@([^/]+)\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/

export function parseConfig(input: ParseConfigInput): Config | ConfigError {
  if (input.bypassLabels === undefined || input.frozenTeams === undefined) {
    return new ConfigError(
      'The "bypass-labels" and "frozen-teams" inputs are required and must be provided by the calling workflow.',
    )
  }

  const bypassLabels = parseBypassLabels(input.bypassLabels)
  const frozenTeams = parseFrozenTeams(input.frozenTeams, input.repoOwner)
  if (frozenTeams instanceof ConfigError) {
    return frozenTeams
  }

  return { bypassLabels, frozenTeams }
}

function splitLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function parseBypassLabels(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of splitLines(raw)) {
    const key = entry.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(entry)
    }
  }
  return result
}

function parseFrozenTeams(raw: string, repoOwner: string): string[] | ConfigError {
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of splitLines(raw)) {
    const match = TEAM_ENTRY_PATTERN.exec(entry)
    if (!match) {
      return new ConfigError(
        `frozen-teams entry "${entry}" is not a valid GitHub team slug. Use the "@org/team-slug" format, e.g. "@my-org/my-team".`,
      )
    }

    const [, org, slug] = match
    if (org.toLowerCase() !== repoOwner.toLowerCase()) {
      return new ConfigError(
        `frozen-teams entry "${entry}" belongs to organization "${org}", but this repository belongs to organization "${repoOwner}". Frozen teams must belong to the repository's own organization.`,
      )
    }

    const normalized = `@${org}/${slug}`
    if (!seen.has(normalized)) {
      seen.add(normalized)
      result.push(normalized)
    }
  }
  return result
}
