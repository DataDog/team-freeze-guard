import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseConfig } from './config'
import { decide, hasBypassLabel } from './decision'
import type { Config } from './config'
import type { Decision } from './decision'
import { resolveParticipants } from './github/participants'
import { resolveTeamMembership } from './github/teams'

type Octokit = ReturnType<typeof getOctokit>

export interface PullRequestContext {
  authorLogin: string
  headSha: string
  labels: string[]
}

export interface Reporter {
  info(message: string): void
  warning(message: string): void
  setFailed(message: string): void
  writeSummary(markdown: string): Promise<void>
}

export interface EvaluateInput {
  bypassLabelsInput: string | undefined
  frozenTeamsInput: string | undefined
  repoOwner: string
  repoName: string
  pullRequest: PullRequestContext | undefined
  octokit: Octokit
  orgOctokit: Octokit
  reporter: Reporter
}

const FROZEN_MESSAGE = 'Your team is frozen'

const FAIL_CLOSED_SUMMARY =
  'The team freeze policy could not be evaluated safely, so this check fails closed rather than ' +
  'silently permitting a merge that might belong to a frozen team. See the workflow run logs for details.'

export async function evaluate(input: EvaluateInput): Promise<void> {
  try {
    await evaluateOrThrow(input)
  } catch (error) {
    input.reporter.warning(error instanceof Error ? error.message : String(error))
    await input.reporter.writeSummary(FAIL_CLOSED_SUMMARY)
    input.reporter.setFailed(FROZEN_MESSAGE)
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

  if (config.frozenTeams.length === 0) {
    input.reporter.info('No frozen teams are configured; passing.')
    return
  }

  if (!input.pullRequest) {
    throw new Error('This event does not carry a pull request context.')
  }

  if (hasBypassLabel(config.bypassLabels, input.pullRequest.labels)) {
    input.reporter.info('A configured bypass label is present; passing without evaluating participants.')
    return
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

  const teamMembership = await resolveTeamMembership({
    octokit: input.orgOctokit,
    org: input.repoOwner,
    teamHandles: config.frozenTeams,
  })

  const decision = decide({
    frozenTeams: config.frozenTeams,
    bypassLabels: config.bypassLabels,
    prLabels: input.pullRequest.labels,
    participants: participants.logins,
    teamMembership,
  })

  if (decision.outcome === 'pass') {
    input.reporter.info('No participant belongs to a frozen team; passing.')
    return
  }

  await reportFailure(decision, config, input.reporter)
}

async function reportFailure(decision: Decision, config: Config, reporter: Reporter): Promise<void> {
  await reporter.writeSummary(buildFailureSummary(decision, config))
  reporter.setFailed(FROZEN_MESSAGE)
}

function buildFailureSummary(decision: Decision, config: Config): string {
  const teams = decision.matchedTeams.join(', ')
  const labels = config.bypassLabels.map((label) => `\`${label}\``).join(', ')
  return [
    'Your team is frozen.',
    '',
    `At least one pull request participant belongs to ${teams}.`,
    `Add one of the following labels before merging this pull request: ${labels}.`,
  ].join('\n')
}

export function run(): void {
  evaluate({
    bypassLabelsInput: core.getInput('bypass-labels'),
    frozenTeamsInput: core.getInput('frozen-teams'),
    repoOwner: context.repo.owner,
    repoName: context.repo.repo,
    pullRequest: extractPullRequestContext(),
    octokit: getOctokit(getRequiredEnv('GITHUB_TOKEN')),
    orgOctokit: getOctokit(getRequiredEnv('ORG_TOKEN')),
    reporter: {
      info: core.info,
      warning: core.warning,
      setFailed: core.setFailed,
      writeSummary: async (markdown) => {
        await core.summary.addRaw(markdown, true).write()
      },
    },
  }).catch((error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error))
  })
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

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable "${name}".`)
  }
  return value
}

if (require.main === module) {
  run()
}
