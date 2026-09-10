// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseConfig } from './config'
import { decide, evaluateBypassConditions, shouldBypass } from './decision'
import type { Config } from './config'
import type { BypassCondition, Decision } from './decision'
import { resolveParticipants } from './github/participants'
import { resolveTeamMembership } from './github/teams'
import { FAIL_CLOSED_MESSAGE, buildReporter, getRequiredEnv, reportFailClosed, safeWriteSummary, type Reporter } from './reporting'

type Octokit = ReturnType<typeof getOctokit>

export interface PullRequestContext {
  authorLogin: string
  headSha: string
  labels: string[]
  title: string
}

export interface EvaluateInput {
  bypassLabelsInput: string | undefined
  bypassTitlePatternInput: string | undefined
  frozenTeamsInput: string | undefined
  frozenMessageInput: string | undefined
  repoOwner: string
  repoName: string
  pullRequest: PullRequestContext | undefined
  octokit: Octokit
  // Octo-STS-issued, org-scoped client used only to resolve frozen-team membership.
  orgOctokit: Octokit
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
    bypassTitlePattern: input.bypassTitlePatternInput,
    frozenTeams: input.frozenTeamsInput,
    frozenMessage: input.frozenMessageInput,
    repoOwner: input.repoOwner,
  })

  if (config instanceof ConfigError) {
    input.reporter.setFailed(config.message)
    return
  }

  if (!input.pullRequest) {
    throw new Error('This event does not carry a pull request context.')
  }

  if (
    shouldBypass({
      bypassLabels: config.bypassLabels,
      bypassTitlePattern: config.bypassTitlePattern,
      prLabels: input.pullRequest.labels,
      prTitle: input.pullRequest.title,
    })
  ) {
    input.reporter.info('The configured bypass conditions are satisfied; passing without evaluating participants.')
    return
  }

  const teamMembership = await resolveTeamMembership({
    octokit: input.orgOctokit,
    org: input.repoOwner,
    teamHandles: config.frozenTeams,
  })

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
    bypassTitlePattern: config.bypassTitlePattern,
    prLabels: input.pullRequest.labels,
    prTitle: input.pullRequest.title,
    participants: participants.logins,
    teamMembership,
  })

  if (decision.outcome === 'pass') {
    input.reporter.info('No participant belongs to a frozen team; passing.')
    return
  }

  await reportFailure(decision, config, input.pullRequest, input.reporter)
}

async function reportFailure(
  decision: Decision,
  config: Config,
  pullRequest: PullRequestContext,
  reporter: Reporter,
): Promise<void> {
  const bypassConditions = evaluateBypassConditions({
    bypassLabels: config.bypassLabels,
    bypassTitlePattern: config.bypassTitlePattern,
    prLabels: pullRequest.labels,
    prTitle: pullRequest.title,
  })

  await safeWriteSummary(reporter, buildFailureSummary(decision, config, bypassConditions))
  reporter.setFailed(buildFailureMessage(decision, config, bypassConditions))
}

function buildFailureHeading(config: Config): string {
  return /[.!?]$/.test(config.frozenMessage) ? config.frozenMessage : `${config.frozenMessage}.`
}

function buildMatchLines(decision: Decision): string[] {
  return decision.matches.map((match) => `- @${match.participant} belongs to frozen team ${match.team}.`)
}

// Reports the current status of every configured bypass mechanism, one line
// each, so the reader can see exactly which one(s) are still missing without
// having to infer it from the overall pass/fail outcome. An unconfigured
// mechanism does not gate the bypass, so it is omitted rather than reported.
function buildBypassConditionLines(config: Config, bypassConditions: BypassCondition[]): string[] {
  const configured = bypassConditions.filter((condition) => condition.configured)

  if (configured.length === 0) {
    return ['No bypass mechanism is configured for this repository; contact an administrator to proceed.']
  }

  return configured.map((condition) => {
    if (condition.mechanism === 'bypass-labels') {
      const labels = config.bypassLabels.map((label) => `\`${label}\``).join(', ')
      return condition.satisfied
        ? '- Bypass label: satisfied.'
        : `- Bypass label: not satisfied — add one of these labels to the pull request: ${labels}.`
    }

    return condition.satisfied
      ? '- Bypass title pattern: satisfied.'
      : `- Bypass title pattern: not satisfied — give the pull request a title matching \`${config.bypassTitlePattern}\`.`
  })
}

function buildFailureMessage(decision: Decision, config: Config, bypassConditions: BypassCondition[]): string {
  return [buildFailureHeading(config), ...buildMatchLines(decision), ...buildBypassConditionLines(config, bypassConditions)].join(
    ' ',
  )
}

function buildFailureSummary(decision: Decision, config: Config, bypassConditions: BypassCondition[]): string {
  const lines = [
    buildFailureHeading(config),
    '',
    ...buildMatchLines(decision),
    '',
    ...buildBypassConditionLines(config, bypassConditions),
  ]

  return lines.join('\n')
}

export function run(): void {
  const reporter = buildReporter()
  runWithReporter(reporter).catch(() => {
    // reportFailClosed handles reporting internally and does not itself throw
    // under normal operation; this is a last-resort backstop.
    core.setFailed(FAIL_CLOSED_MESSAGE)
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
    bypassTitlePatternInput: core.getInput('bypass-title-pattern'),
    frozenTeamsInput: core.getInput('frozen-teams'),
    frozenMessageInput: core.getInput('frozen-message'),
    repoOwner: context.repo.owner,
    repoName: context.repo.repo,
    pullRequest: extractPullRequestContext(),
    octokit: getOctokit(getRequiredEnv('GITHUB_TOKEN')),
    orgOctokit: getOctokit(getRequiredEnv('ORG_TOKEN')),
    reporter,
  }
}

function extractPullRequestContext(): PullRequestContext | undefined {
  const pullRequest = context.payload.pull_request as
    | { user?: { login?: string }; head?: { sha?: string }; labels?: Array<{ name?: string }>; title?: string }
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
    title: pullRequest.title ?? '',
  }
}

if (require.main === module) {
  run()
}
