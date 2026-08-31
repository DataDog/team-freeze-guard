import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { readFileSync } from 'fs'
import { ConfigError, parseConfig } from './config'
import { decide, hasBypassLabel } from './decision'
import type { Config } from './config'
import type { Decision } from './decision'
import { resolveParticipants } from './github/participants'
import { FROZEN_MESSAGE, buildReporter, getRequiredEnv, reportFailClosed, safeWriteSummary, type Reporter } from './reporting'

type Octokit = ReturnType<typeof getOctokit>

export interface PullRequestContext {
  authorLogin: string
  headSha: string
  labels: string[]
}

export interface EvaluateInput {
  bypassLabelsInput: string | undefined
  frozenTeamsInput: string | undefined
  repoOwner: string
  repoName: string
  pullRequest: PullRequestContext | undefined
  octokit: Octokit
  // Resolved by the "Resolve frozen team membership" step and read from its output
  // file; this entrypoint never talks to the org-scoped API itself.
  teamMembership: Map<string, Set<string>>
  reporter: Reporter
}

export async function evaluate(input: EvaluateInput): Promise<void> {
  try {
    await evaluateOrThrow(input)
  } catch (error) {
    await reportFailClosed(input.reporter, error)
  }
}

async function evaluateOrThrow(input: EvaluateInput): Promise<void> {
  const config = parseConfig({
    bypassLabels: input.bypassLabelsInput,
    frozenTeams: input.frozenTeamsInput,
    repoOwner: input.repoOwner,
  })

  if (config instanceof ConfigError) {
    input.reporter.setFailed(config.message)
    return
  }

  if (!input.pullRequest) {
    throw new Error('This event does not carry a pull request context.')
  }

  if (hasBypassLabel(config.bypassLabels, input.pullRequest.labels)) {
    input.reporter.info('A configured bypass label is present; passing without evaluating participants.')
    return
  }

  const missingTeams = config.frozenTeams.filter((team) => !input.teamMembership.has(team))
  if (missingTeams.length > 0) {
    throw new Error(
      `Team membership resolution did not include: ${missingTeams.join(', ')}. Refusing to treat missing teams as empty.`,
    )
  }

  const participants = await resolveParticipants({
    octokit: input.octokit,
    owner: input.repoOwner,
    repo: input.repoName,
    headSha: input.pullRequest.headSha,
    prAuthorLogin: input.pullRequest.authorLogin,
  })

  for (const identity of participants.unmappedIdentities) {
    input.reporter.warning(
      `Could not map commit identity "${identity}" to a GitHub account; it was not checked against frozen teams.`,
    )
  }

  const decision = decide({
    frozenTeams: config.frozenTeams,
    bypassLabels: config.bypassLabels,
    prLabels: input.pullRequest.labels,
    participants: participants.logins,
    teamMembership: input.teamMembership,
  })

  if (decision.outcome === 'pass') {
    input.reporter.info('No participant belongs to a frozen team; passing.')
    return
  }

  await reportFailure(decision, config, input.reporter)
}

async function reportFailure(decision: Decision, config: Config, reporter: Reporter): Promise<void> {
  await safeWriteSummary(reporter, buildFailureSummary(decision, config))
  reporter.setFailed(FROZEN_MESSAGE)
}

function buildFailureSummary(decision: Decision, config: Config): string {
  const teams = decision.matchedTeams.join(', ')
  const lines = [
    'Your team is frozen.',
    '',
    `At least one pull request participant belongs to ${teams}.`,
  ]

  if (config.bypassLabels.length > 0) {
    const labels = config.bypassLabels.map((label) => `\`${label}\``).join(', ')
    lines.push(`Add one of the following labels before merging this pull request: ${labels}.`)
  } else {
    lines.push('No bypass labels are configured for this repository; contact an administrator to proceed.')
  }

  return lines.join('\n')
}

export function run(): void {
  const reporter = buildReporter()
  runWithReporter(reporter).catch(() => {
    // reportFailClosed handles reporting internally and does not itself throw
    // under normal operation; this is a last-resort backstop.
    core.setFailed(FROZEN_MESSAGE)
  })
}

async function runWithReporter(reporter: Reporter): Promise<void> {
  try {
    await evaluate(buildEvaluateInput(reporter))
  } catch (error) {
    await reportFailClosed(reporter, error)
  }
}

function buildEvaluateInput(reporter: Reporter): EvaluateInput {
  return {
    bypassLabelsInput: core.getInput('bypass-labels'),
    frozenTeamsInput: core.getInput('frozen-teams'),
    repoOwner: context.repo.owner,
    repoName: context.repo.repo,
    pullRequest: extractPullRequestContext(),
    octokit: getOctokit(getRequiredEnv('GITHUB_TOKEN')),
    teamMembership: parseTeamMembership(readFileSync(getRequiredEnv('TEAM_MEMBERSHIP_FILE'), 'utf8')),
    reporter,
  }
}

function parseTeamMembership(raw: string): Map<string, Set<string>> {
  const parsed = JSON.parse(raw) as Record<string, string[]>
  return new Map(Object.entries(parsed).map(([team, members]) => [team, new Set(members)]))
}

function extractPullRequestContext(): PullRequestContext | undefined {
  const pullRequest = context.payload.pull_request as
    | { user?: { login?: string }; head?: { sha?: string }; labels?: Array<{ name?: string }> }
    | undefined

  if (!pullRequest?.user?.login || !pullRequest.head?.sha) {
    return undefined
  }

  return {
    authorLogin: pullRequest.user.login,
    headSha: pullRequest.head.sha,
    labels: (pullRequest.labels ?? [])
      .map((label) => label.name)
      .filter((name): name is string => typeof name === 'string'),
  }
}

if (require.main === module) {
  run()
}
