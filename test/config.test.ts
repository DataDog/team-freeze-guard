// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { ConfigError, parseConfig, parseFrozenTeamsInput } from '../src/config'

const repoOwner = 'my-org'
const frozenMessage = 'Your team is frozen'

describe('parseConfig', () => {
  it('parses valid bypass-labels', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nhotfix',
      bypassTitlePattern: '',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'hotfix'],
      bypassTitlePattern: '',
      frozenMessage,
    })
  })

  it('treats an empty bypass-labels list as valid', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenMessage,
    })
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const result = parseConfig({
      bypassLabels: '\n  ci-remediation  \n\n',
      bypassTitlePattern: '',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation'],
      bypassTitlePattern: '',
      frozenMessage,
    })
  })

  it('deduplicates bypass-labels by exact match only, keeping distinct casings', () => {
    const result = parseConfig({
      bypassLabels: 'ci-remediation\nCI-Remediation\nci-remediation',
      bypassTitlePattern: '',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: ['ci-remediation', 'CI-Remediation'],
      bypassTitlePattern: '',
      frozenMessage,
    })
  })

  it('uses whatever frozen-message the calling workflow provides, unmodified', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenMessage: 'Merges are paused for this team',
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenMessage: 'Merges are paused for this team',
    })
  })

  it('fails closed when bypass-labels is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: undefined,
      bypassTitlePattern: '',
      frozenMessage,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('fails closed when bypass-title-pattern is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: undefined,
      frozenMessage,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('treats an empty bypass-title-pattern as valid and disabled', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '   ',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '',
      frozenMessage,
    })
  })

  it('accepts a valid bypass-title-pattern regular expression', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '^\\[hotfix\\]',
      frozenMessage,
    })

    expect(result).toEqual({
      bypassLabels: [],
      bypassTitlePattern: '^\\[hotfix\\]',
      frozenMessage,
    })
  })

  it('rejects an invalid bypass-title-pattern regular expression', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '[hotfix',
      frozenMessage,
    })

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('[hotfix')
  })

  it('fails closed when frozen-message is missing (undefined)', () => {
    const result = parseConfig({
      bypassLabels: '',
      bypassTitlePattern: '',
      frozenMessage: undefined,
    })

    expect(result).toBeInstanceOf(ConfigError)
  })
})

describe('parseFrozenTeamsInput', () => {
  it('parses valid frozen-teams entries', () => {
    const result = parseFrozenTeamsInput('@my-org/apm-sdk\n@my-org/profiling', repoOwner)

    expect(result).toEqual(['@my-org/apm-sdk', '@my-org/profiling'])
  })

  it('treats an empty frozen-teams list as valid and disabled', () => {
    const result = parseFrozenTeamsInput('', repoOwner)

    expect(result).toEqual([])
  })

  it('ignores blank lines and surrounding whitespace', () => {
    const result = parseFrozenTeamsInput('\n\n  @my-org/apm-sdk  \n', repoOwner)

    expect(result).toEqual(['@my-org/apm-sdk'])
  })

  it('deduplicates frozen-teams entries', () => {
    const result = parseFrozenTeamsInput('@my-org/apm-sdk\n@my-org/apm-sdk', repoOwner)

    expect(result).toEqual(['@my-org/apm-sdk'])
  })

  it('fails closed when frozen-teams is missing (undefined)', () => {
    const result = parseFrozenTeamsInput(undefined, repoOwner)

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a display name instead of a team slug', () => {
    const result = parseFrozenTeamsInput('@my-org/APM SDK', repoOwner)

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('APM SDK')
  })

  it('rejects a bare slug with no org', () => {
    const result = parseFrozenTeamsInput('apm-sdk', repoOwner)

    expect(result).toBeInstanceOf(ConfigError)
  })

  it('rejects a team from a different organization', () => {
    const result = parseFrozenTeamsInput('@other-org/apm-sdk', repoOwner)

    expect(result).toBeInstanceOf(ConfigError)
    expect((result as ConfigError).message).toContain('other-org')
    expect((result as ConfigError).message).toContain(repoOwner)
  })

  it('rejects an organization that only differs from the repo owner by case', () => {
    const result = parseFrozenTeamsInput('@My-Org/apm-sdk', repoOwner)

    expect(result).toBeInstanceOf(ConfigError)
  })
})
