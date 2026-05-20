import { describe, expect, it } from 'vitest'

import {
  isFiniteNumber,
  isJsonRecord,
  isNonEmptyString,
  isRecord,
  isStorageRecord,
  isStringArray,
  toError,
} from '@/src/shared/type-guards'

describe('shared type guards', () => {
  it('accepts non-null object records and rejects arrays or nullish values', () => {
    expect(isRecord({ id: 'series-1' })).toBe(true)
    expect(isJsonRecord({ count: 1, nested: { ok: true } })).toBe(true)
    expect(isStorageRecord({ enabled: false })).toBe(true)

    for (const value of [null, undefined, ['chapter'], 'text', 12]) {
      expect(isRecord(value)).toBe(false)
      expect(isJsonRecord(value)).toBe(false)
      expect(isStorageRecord(value)).toBe(false)
    }
  })

  it('narrows strings only when they contain at least one character', () => {
    expect(isNonEmptyString('0')).toBe(true)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(0)).toBe(false)
  })

  it('accepts only finite numeric values', () => {
    expect(isFiniteNumber(0)).toBe(true)
    expect(isFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(true)

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '1', null]) {
      expect(isFiniteNumber(value)).toBe(false)
    }
  })

  it('accepts arrays only when every item is a string', () => {
    expect(isStringArray([])).toBe(true)
    expect(isStringArray(['a', 'b'])).toBe(true)
    expect(isStringArray(['a', 1])).toBe(false)
    expect(isStringArray({ 0: 'a' })).toBe(false)
  })

  it('normalizes unknown thrown values to Error instances', () => {
    const original = new Error('kept')

    expect(toError(original)).toBe(original)
    expect(toError('network failed')).toMatchObject({ message: 'network failed' })
    expect(toError({ reason: 'unknown' }, 'fallback message')).toMatchObject({ message: 'fallback message' })
  })
})
