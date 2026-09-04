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

export async function resolveParticipants(input: ResolveParticipantsInput): Promise<Participants> {
  const logins = new Set<string>([input.prAuthorLogin])
  const unmappedIdentities = new Set<string>()

  const { data: commit } = await input.octokit.rest.repos.getCommit({
    owner: input.owner,
    repo: input.repo,
    ref: input.headSha,
  })

  recordIdentity(
    commit.committer?.login ?? null,
    formatUnmappedIdentity(commit.commit.committer?.name, commit.commit.committer?.email),
    logins,
    unmappedIdentities,
  )

  return { logins: [...logins], unmappedIdentities: [...unmappedIdentities] }
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
