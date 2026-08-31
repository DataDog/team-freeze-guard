import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseFrozenTeamsInput } from './config'
import { resolveTeamMembership } from './github/teams'
import { FROZEN_MESSAGE, buildReporter, getRequiredEnv, reportFailClosed, type Reporter } from './reporting'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveTeamMembershipStepInput {
  frozenTeamsInput: string | undefined
  repoOwner: string
  octokit: Octokit
  reporter: Reporter
  setOutput: (name: string, value: string) => void
}

export async function resolveAndOutputTeamMembership(input: ResolveTeamMembershipStepInput): Promise<void> {
  try {
    await resolveOrThrow(input)
  } catch (error) {
    await reportFailClosed(input.reporter, error)
  }
}

async function resolveOrThrow(input: ResolveTeamMembershipStepInput): Promise<void> {
  const frozenTeams = parseFrozenTeamsInput(input.frozenTeamsInput, input.repoOwner)

  if (frozenTeams instanceof ConfigError) {
    input.reporter.setFailed(frozenTeams.message)
    return
  }

  const membership = await resolveTeamMembership({
    octokit: input.octokit,
    org: input.repoOwner,
    teamHandles: frozenTeams,
  })

  input.setOutput('team-membership', serializeMembership(membership))
}

function serializeMembership(membership: Map<string, Set<string>>): string {
  const asRecord = Object.fromEntries([...membership].map(([team, members]) => [team, [...members]]))
  return JSON.stringify(asRecord)
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
    await resolveAndOutputTeamMembership(buildInput(reporter))
  } catch (error) {
    await reportFailClosed(reporter, error)
  }
}

function buildInput(reporter: Reporter): ResolveTeamMembershipStepInput {
  return {
    frozenTeamsInput: core.getInput('frozen-teams'),
    repoOwner: context.repo.owner,
    octokit: getOctokit(getRequiredEnv('ORG_TOKEN')),
    reporter,
    setOutput: core.setOutput,
  }
}

if (require.main === module) {
  run()
}
