// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseFrozenTeamsInput } from './config'
import { resolveTeamMembership } from './github/teams'
import { FAIL_CLOSED_MESSAGE, buildReporter, getRequiredEnv, reportFailClosed, type Reporter } from './reporting'
import { writeTeamMembershipFile } from './team-membership-file'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveMembershipInput {
  frozenTeamsInput: string | undefined
  repoOwner: string
  // Octo-STS-issued, org-scoped client used to resolve frozen-team membership.
  orgOctokit: Octokit
  outputPath: string
  reporter: Reporter
}

export async function resolveMembership(input: ResolveMembershipInput): Promise<void> {
  try {
    await resolveMembershipOrThrow(input)
  } catch (error) {
    await reportFailClosed(input.reporter, error)
  }
}

async function resolveMembershipOrThrow(input: ResolveMembershipInput): Promise<void> {
  const frozenTeams = parseFrozenTeamsInput(input.frozenTeamsInput, input.repoOwner)

  if (frozenTeams instanceof ConfigError) {
    input.reporter.setFailed(frozenTeams.message)
    return
  }

  const teamMembership = await resolveTeamMembership({
    octokit: input.orgOctokit,
    org: input.repoOwner,
    teamHandles: frozenTeams,
  })

  await writeTeamMembershipFile(input.outputPath, teamMembership)
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
    await resolveMembership(buildResolveMembershipInput(reporter))
  } catch (error) {
    await reportFailClosed(reporter, error)
  }
}

function buildResolveMembershipInput(reporter: Reporter): ResolveMembershipInput {
  return {
    frozenTeamsInput: core.getInput('frozen-teams'),
    repoOwner: context.repo.owner,
    orgOctokit: getOctokit(getRequiredEnv('ORG_TOKEN')),
    outputPath: getRequiredEnv('TEAM_MEMBERSHIP_FILE'),
    reporter,
  }
}

if (require.main === module) {
  run()
}
