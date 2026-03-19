import { describe, it, expect, vi } from 'vitest'
import { withRetries } from '@/entrypoints/offscreen/image-processor'

// Retry policy behavior
// Validates:
// - Exponential backoff delays [1000, 3000, 9000] ms for 5xx/429-like errors
// - No retries for non-429 4xx errors
// - Single consolidated failure after final attempt

describe('Retry policy', () => {
  it('uses exponential backoff 1000, 3000, 9000 for 5xx errors', async () => {
    const error = new Error('HTTP 500: Server error')
    const fn = vi.fn(async () => {
      throw error
    })
    const delays: number[] = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: (...args: unknown[]) => void, delay?: number) => {
        delays.push(delay ?? 0)
        cb()
        return 0 as unknown as number
      }) as unknown as typeof setTimeout)

    await expect(withRetries(fn, 4)).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(4)

    expect(delays.slice(0, 3)).toEqual([1000, 3000, 9000])
    setTimeoutSpy.mockRestore()
  })

  it('does not retry on non-429 4xx errors', async () => {
    const error = new Error('HTTP 404: Not Found')
    const fn = vi.fn(async () => {
      throw error
    })
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    await expect(withRetries(fn, 4)).rejects.toBe(error)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
    setTimeoutSpy.mockRestore()
  })

  it('retries on 429 errors with exponential backoff', async () => {
    const error = new Error('HTTP 429: Too Many Requests')
    const successValue = 'ok'
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts++
      if (attempts <= 2) {
        throw error
      }
      return successValue
    })

    const delays: number[] = []
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: (...args: unknown[]) => void, delay?: number) => {
        delays.push(delay ?? 0)
        cb()
        return 0 as unknown as number
      }) as unknown as typeof setTimeout)

    await expect(withRetries(fn, 4)).resolves.toBe(successValue)
    expect(fn).toHaveBeenCalledTimes(3)

    expect(delays.slice(0, 2)).toEqual([1000, 3000])
    setTimeoutSpy.mockRestore()
  })
})
