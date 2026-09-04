// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from '../src/config'

const repoOwner = 'my-org'

describe('parseConfig', () => {
  it('parses valid bypass-labels and frozen-teams lists', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nhotfix',
      frozenTeams: '@my-org/apm-sdk\n@my-org/profiling',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'hotfix'],
      frozenTeams: ['@my-org/apm-sdk', '@my-org/profiling'],
    })
  })

  it('treats an empty frozen-teams list as valid and disabled', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation',
      frozenTeams: '',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation'],
      frozenTeams: [],
    })
  })

  it('treats an empty bypass-labels list as valid', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: '@my-org/apm-sdk',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      frozenTeams: ['@my-org/apm-sdk'],
    })
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const result = parseConfig({
      bypassLabels: '\n  ci-remediation  \n\n',
      frozenTeams: '\n\n  @my-org/apm-sdk  \n',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation'],
      frozenTeams: ['@my-org/apm-sdk'],
    })
  })

  it('deduplicates bypass-labels by exact match only, keeping distinct casings', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nCI-Remediation\nci-remediation',
      frozenTeams: '',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'CI-Remediation'],
      frozenTeams: [],
    })
  })

  it('deduplicates frozen-teams entries', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: '@my-org/apm-sdk\n@my-org/apm-sdk',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      frozenTeams: ['@my-org/apm-sdk'],
    })
  })

  it('fails closed when bypass-labels is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: undefined,
      frozenTeams: '',
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('fails closed when frozen-teams is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: undefined,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a display name instead of a team slug', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: '@my-org/APM SDK',
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('APM SDK')
  })

  it('rejects a bare slug with no org', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: 'apm-sdk',
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a team from a different organization', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: '@other-org/apm-sdk',
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('other-org')
    expect((result as ConfigError).message).toContain(repoOwner)
  })

  it('rejects an organization that only differs from the repo owner by case', () => {
    const result = parseConfig({
      bypassLabels: '',
      frozenTeams: '@My-Org/apm-sdk',
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })
})
