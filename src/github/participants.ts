// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import type { getOctokit } from '@actions/github'

type Octokit = ReturnType<typeof getOctokit>

export interface ResolveParticipantsInput {
  octokit: Octokit
  owner: string
  repo: string
  headSha: string
  prAuthorLogin: string
}

export interface Participants {
  logins: string[]
  unmappedIdentities: string[]
}

const GET_COMMIT_RETRY_ATTEMPTS = 3
const GET_COMMIT_RETRY_DELAY_MS = 5000

export async function resolveParticipants(input: ResolveParticipantsInput): Promise<Participants> {
  const logins = new Set<string>([input.prAuthorLogin])
  const unmappedIdentities = new Set<string>()

  const commit = await getHeadCommitWithRetry(input)

  if (commit) {
    recordIdentity(
      commit.committer?.login ?? null,
      formatUnmappedIdentity(commit.commit.committer?.name, commit.commit.committer?.email),
      logins,
      unmappedIdentities,
    )
  }

  return { logins: [...logins], unmappedIdentities: [...unmappedIdentities] }
}

// The head commit lookup is best-effort: if it keeps failing (e.g. transient GitHub API
// flakiness) we skip checking the last committer rather than fail the whole PR closed.
async function getHeadCommitWithRetry(
  input: ResolveParticipantsInput,
): Promise<Awaited<ReturnType<Octokit['rest']['repos']['getCommit']>>['data'] | null> {
  for (let attempt = 1; attempt <= GET_COMMIT_RETRY_ATTEMPTS; attempt++) {
    try {
      const { data: commit } = await input.octokit.rest.repos.getCommit({
        owner: input.owner,
        repo: input.repo,
        ref: input.headSha,
      })
      return commit
    } catch {
      if (attempt === GET_COMMIT_RETRY_ATTEMPTS) {
        return null
      }
      await sleep(GET_COMMIT_RETRY_DELAY_MS)
    }
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatUnmappedIdentity(name: string | undefined, email: string | undefined): string | null {
  if (!name) {
    return null
  }
  return email ? `${name} <${email}>` : name
}

function recordIdentity(
  login: string | null,
  unmappedIdentity: string | null,
  logins: Set<string>,
  unmappedIdentities: Set<string>,
): void {
  if (login) {
    logins.add(login)
    return
  }
  if (unmappedIdentity) {
    unmappedIdentities.add(unmappedIdentity)
  }
}
