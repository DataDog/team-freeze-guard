// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig } from '../src/config'

const repoOwner = 'my-org'
const frozenMessage = 'Your team is frozen'

describe('parseConfig', () => {
  it('parses valid bypass-labels and frozen-teams lists', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nhotfix',
      bypassTitlePattern: '',
      frozenTeams: '@my-org/apm-sdk\n@my-org/profiling',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'hotfix'],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk', '@my-org/profiling'],
      frozenMessage,
    })
  })

  it('treats an empty frozen-teams list as valid and disabled', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation',
      bypassTitlePattern: '',
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation'],
      bypassTitlePattern: '',
      frozenTeams: [],
      frozenMessage,
    })
  })

  it('treats an empty bypass-labels list as valid', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@my-org/apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk'],
      frozenMessage,
    })
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const result = parseConfig({
      bypassLabels: '\n  ci-remediation  \n\n',
      bypassTitlePattern: '',
      frozenTeams: '\n\n  @my-org/apm-sdk  \n',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation'],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk'],
      frozenMessage,
    })
  })

  it('deduplicates bypass-labels by exact match only, keeping distinct casings', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nCI-Remediation\nci-remediation',
      bypassTitlePattern: '',
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'CI-Remediation'],
      bypassTitlePattern: '',
      frozenTeams: [],
      frozenMessage,
    })
  })

  it('deduplicates frozen-teams entries', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@my-org/apm-sdk\n@my-org/apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk'],
      frozenMessage,
    })
  })

  it('uses whatever frozen-message the calling workflow provides, unmodified', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@my-org/apm-sdk',
      frozenMessage: 'Merges are paused for this team',
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk'],
      frozenMessage: 'Merges are paused for this team',
    })
  })

  it('fails closed when bypass-labels is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: undefined,
      bypassTitlePattern: '',
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('fails closed when bypass-title-pattern is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: undefined,
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('treats an empty bypass-title-pattern as valid and disabled', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '   ',
      frozenTeams: '@my-org/apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenTeams: ['@my-org/apm-sdk'],
      frozenMessage,
    })
  })

  it('accepts a valid bypass-title-pattern regular expression', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '^\\[hotfix\\]',
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '^\\[hotfix\\]',
      frozenTeams: [],
      frozenMessage,
    })
  })

  it('rejects an invalid bypass-title-pattern regular expression', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '[hotfix',
      frozenTeams: '',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('[hotfix')
  })

  it('fails closed when frozen-teams is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: undefined,
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('fails closed when frozen-message is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '',
      frozenMessage: undefined,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a display name instead of a team slug', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@my-org/APM SDK',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('APM SDK')
  })

  it('rejects a bare slug with no org', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: 'apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a team from a different organization', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@other-org/apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('other-org')
    expect((result as ConfigError).message).toContain(repoOwner)
  })

  it('rejects an organization that only differs from the repo owner by case', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenTeams: '@My-Org/apm-sdk',
      frozenMessage,
      repoOwner,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })
})
