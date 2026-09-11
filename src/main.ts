// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { readFileSync, writeFileSync } from 'node:fs'
import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseConfig, parseFrozenTeamsInput } from './config'
import { decide, evaluateBypassConditions, shouldBypass } from './decision'
import type { Config } from './config'
import type { BypassCondition, Decision } from './decision'
import { resolveTeamMembership } from './github/teams'
import {
  MembershipCacheError,
  parseMembershipSnapshot,
  serializeMembershipSnapshot,
} from './membership-cache'
import {
  FAIL_CLOSED_MESSAGE,
  buildReporter,
  getRequiredEnv,
  reportFailClosed,
  safeWriteSummary,
  type Reporter,
} from './reporting'

type Octokit = ReturnType<typeof getOctokit>

export interface PullRequestContext {
  authorLogin: string
  labels: string[]
  title: string
}

export interface EvaluateInput {
  bypassLabelsInput: string | undefined
  bypassTitlePatternInput: string | undefined
  frozenTeamsInput: string | undefined
  frozenMessageInput: string | undefined
  repoOwner: string
  pullRequest: PullRequestContext | undefined
  readMembershipSnapshot: () => string
  now?: Date
  reporter: Reporter
}

export interface RefreshInput {
  frozenTeamsInput: string | undefined
  repoOwner: string
  orgOctokit: Octokit
  generatedAt?: Date
  writeSnapshot: (snapshot: string) => void
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

  if (config.frozenTeams.length === 0) {
    input.reporter.info('No frozen teams configured; passing.')
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
    input.reporter.info(
      'The configured bypass conditions are satisfied; passing without evaluating the pull request author.',
    )
    return
  }

  const teamMembership = parseMembershipSnapshot(
    input.readMembershipSnapshot(),
    config.frozenTeams,
    input.now,
  )
  const decision = decide({
    frozenTeams: config.frozenTeams,
    bypassLabels: config.bypassLabels,
    bypassTitlePattern: config.bypassTitlePattern,
    prLabels: input.pullRequest.labels,
    prTitle: input.pullRequest.title,
    participants: [input.pullRequest.authorLogin],
    teamMembership,
  })

  if (decision.outcome === 'pass') {
    input.reporter.info('The pull request author does not belong to a frozen team; passing.')
    return
  }

  await reportFailure(decision, config, input.pullRequest, input.reporter)
}

export async function refreshMembership(input: RefreshInput): Promise<void> {
  try {
    const frozenTeams = parseFrozenTeamsInput(input.frozenTeamsInput, input.repoOwner)
    if (frozenTeams instanceof ConfigError) {
      input.reporter.setFailed(frozenTeams.message)
      return
    }
    if (frozenTeams.length === 0) {
      input.reporter.info('No frozen teams configured; no membership cache is needed.')
      return
    }

    const membership = await resolveTeamMembership({
      octokit: input.orgOctokit,
      org: input.repoOwner,
      teamHandles: frozenTeams,
    })
    input.writeSnapshot(serializeMembershipSnapshot(membership, input.generatedAt))
    input.reporter.info(
      `Resolved and cached membership for ${String(frozenTeams.length)} team(s).`,
    )
  } catch (error) {
    await reportFailClosed(input.reporter, error)
  }
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
  return decision.matches.map(
    (match) => `- @${match.participant} belongs to frozen team ${match.team}.`,
  )
}

// Reports the current status of every configured bypass mechanism, one line
// each, so the reader can see exactly which one(s) are still missing without
// having to infer it from the overall pass/fail outcome. An unconfigured
// mechanism does not gate the bypass, so it is omitted rather than reported.
function buildBypassConditionLines(
  config: Config,
  bypassConditions: BypassCondition[],
): string[] {
  const configured = bypassConditions.filter((condition) => condition.configured)

  if (configured.length === 0) {
    return [
      'No bypass mechanism is configured for this repository; contact an administrator to proceed.',
    ]
  }

  return configured.map((condition) => {
    if (condition.mechanism === 'bypass-labels') {
      const labels = config.bypassLabels.map((label) => `\`${label}\``).join(', ')
      return condition.satisfied
        ? '- Bypass label: satisfied.'
        : `- Bypass label: not satisfied — if your PR is meant to fix the freeze root cause, please add one of these labels: ${labels}.`
    }

    return condition.satisfied
      ? '- Bypass title pattern: satisfied.'
      : `- Bypass title pattern: not satisfied — if your PR is meant to fix the freeze root cause, please correct the PR title to match \`${config.bypassTitlePattern}\`.`
  })
}

function buildFailureMessage(
  decision: Decision,
  config: Config,
  bypassConditions: BypassCondition[],
): string {
  return [
    buildFailureHeading(config),
    ...buildMatchLines(decision),
    ...buildBypassConditionLines(config, bypassConditions),
  ].join(' ')
}

function buildFailureSummary(
  decision: Decision,
  config: Config,
  bypassConditions: BypassCondition[],
): string {
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

export function runRefresh(): void {
  const reporter = buildReporter()
  runRefreshWithReporter(reporter).catch(() => {
    core.setFailed(FAIL_CLOSED_MESSAGE)
  })
}

async function runRefreshWithReporter(reporter: Reporter): Promise<void> {
  try {
    const membershipFile = getRequiredEnv('TEAM_MEMBERSHIP_FILE')
    await refreshMembership({
      frozenTeamsInput: core.getInput('frozen-teams'),
      repoOwner: context.repo.owner,
      orgOctokit: getOctokit(getRequiredEnv('ORG_TOKEN')),
      writeSnapshot: (snapshot) => writeFileSync(membershipFile, snapshot, 'utf8'),
      reporter,
    })
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
    pullRequest: extractPullRequestContext(),
    readMembershipSnapshot: () => {
      const membershipFile = getRequiredEnv('TEAM_MEMBERSHIP_FILE')
      try {
        return readFileSync(membershipFile, 'utf8')
      } catch (error) {
        throw new MembershipCacheError(
          'Membership cache is unavailable; run its refresh workflow.',
          { cause: error },
        )
      }
    },
    reporter,
  }
}

function extractPullRequestContext(): PullRequestContext | undefined {
  const pullRequest = context.payload.pull_request as
    | { user?: { login?: string }; labels?: Array<{ name?: string }>; title?: string }
    | undefined

  if (!pullRequest?.user?.login) {
    return undefined
  }

  return {
    authorLogin: pullRequest.user.login,
    labels: (pullRequest.labels ?? [])
      .map((label) => label.name)
      .filter((name): name is string => typeof name === 'string'),
    title: pullRequest.title ?? '',
  }
}

if (require.main === module) {
  if (process.env.TEAM_FREEZE_GUARD_MODE === 'refresh') {
    runRefresh()
  } else {
    run()
  }
}
