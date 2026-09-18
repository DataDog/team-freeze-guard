// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2026 Datadog, Inc.

import { describe, expect, it } from 'vitest'
import { formatError } from '../src/reporting'

describe('formatError', () => {
  it('returns the message of an Error, never its stack trace', () => {
    expect(formatError(new Error('boom'))).toBe('boom')
  })

  it('formats a non-Error throwable as readable JSON instead of "[object Object]"', () => {
    expect(formatError({ status: 404, message: 'Not Found' })).toBe(
      JSON.stringify({ status: 404, message: 'Not Found' }),
    )
  })
})
