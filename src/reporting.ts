// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import * as core from '@actions/core'

export interface Reporter {
  info(message: string): void
  warning(message: string): void
  setFailed(message: string): void
  writeSummary(markdown: string): Promise<void>
}

export const FROZEN_MESSAGE = 'Your team is frozen'

export const FAIL_CLOSED_SUMMARY =
  'The team freeze policy could not be evaluated safely, so this check fails closed rather than ' +
  'silently permitting a merge that might belong to a frozen team. See the workflow run logs for details.'

export function buildReporter(): Reporter {
  return {
    info: core.info,
    warning: core.warning,
    setFailed: core.setFailed,
    writeSummary: async (markdown) => {
      await core.summary.addRaw(markdown, true).write()
    },
  }
}

export async function reportFailClosed(reporter: Reporter, error: unknown): Promise<void> {
  reporter.warning(formatError(error))
  await safeWriteSummary(reporter, FAIL_CLOSED_SUMMARY)
  reporter.setFailed(FROZEN_MESSAGE)
}

export async function safeWriteSummary(reporter: Reporter, markdown: string): Promise<void> {
  try {
    await reporter.writeSummary(markdown)
  } catch (error) {
    reporter.warning(`Failed to write the job summary: ${formatError(error)}`)
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable "${name}".`)
  }
  return value
}
