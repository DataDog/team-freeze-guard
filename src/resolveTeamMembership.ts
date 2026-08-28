import * as core from '@actions/core'
import { context, getOctokit } from '@actions/github'
import { ConfigError, parseConfig } from './config'
import { resolveTeamMembership } from './github/teams'
import { FROZEN_MESSAGE, buildReporter, getRequiredEnv, reportFailClosed, type Reporter } from './reporting'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveTeamMembershipStepInput {
  bypassLabelsInput: string | undefined
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
  const config = parseConfig({
    bypassLabels: input.bypassLabelsInput,
    frozenTeams: input.frozenTeamsInput,
    repoOwner: input.repoOwner,
  })

  if (config instanceof ConfigError) {
    input.reporter.setFailed(config.message)
    return
  }

  const membership = await resolveTeamMembership({
    octokit: input.octokit,
    org: input.repoOwner,
    teamHandles: config.frozenTeams,
  })

  input.setOutput('team-membership', serializeMembership(membership))
}

function serializeMembership(membership: Map<string, Set<string>>): string {
  const asRecord = Object.fromEntries([...membership].map(([team, members]) => [team, [...members]]))
  return JSON.stringify(asRecord)
}

export function run(): void {
  const reporter = buildReporter()
  resolveAndOutputTeamMembership(buildInput(reporter)).catch(() => {
    // reportFailClosed handles reporting internally and does not itself throw
    // under normal operation; this is a last-resort backstop.
    core.setFailed(FROZEN_MESSAGE)
  })
}

function buildInput(reporter: Reporter): ResolveTeamMembershipStepInput {
  return {
    bypassLabelsInput: core.getInput('bypass-labels'),
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
