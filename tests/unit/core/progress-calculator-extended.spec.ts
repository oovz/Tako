import { describe, it, expect, beforeEach } from 'vitest'

import { IntelligentProgressCalculator } from '@/src/runtime/progress-calculator'

describe('estimateTimeRemaining', () => {
  let calculator: IntelligentProgressCalculator

  beforeEach(() => {
    calculator = new IntelligentProgressCalculator()
  })

  it('returns null when progress is at or below 5% (too early)', () => {
    expect(calculator.estimateTimeRemaining(0, 10_000)).toBeNull()
    expect(calculator.estimateTimeRemaining(5, 10_000)).toBeNull()
  })

  it('returns a positive number when progress > 5%', () => {
    const result = calculator.estimateTimeRemaining(50, 10_000)
    expect(result).not.toBeNull()
    expect(typeof result).toBe('number')
    expect(result!).toBeGreaterThan(0)
  })

  it('estimates remaining time proportional to elapsed time', () => {
    const elapsed = 10_000
    const progress = 50
    const result = calculator.estimateTimeRemaining(progress, elapsed)

    expect(result).not.toBeNull()
    expect(result!).toBeCloseTo(10_000, -1)
  })

  it('returns smaller remaining time as progress increases', () => {
    const elapsed = 10_000
    const at25 = calculator.estimateTimeRemaining(25, elapsed)
    const at50 = calculator.estimateTimeRemaining(50, elapsed)
    const at75 = calculator.estimateTimeRemaining(75, elapsed)

    expect(at25).not.toBeNull()
    expect(at50).not.toBeNull()
    expect(at75).not.toBeNull()
    expect(at50!).toBeLessThan(at25!)
    expect(at75!).toBeLessThan(at50!)
  })

  it('returns close to zero when progress is near 100%', () => {
    const result = calculator.estimateTimeRemaining(99, 10_000)
    expect(result).not.toBeNull()
    expect(result!).toBeLessThan(200)
  })

  it('returns an integer (rounded)', () => {
    const result = calculator.estimateTimeRemaining(33, 10_000)
    expect(result).not.toBeNull()
    expect(Number.isInteger(result)).toBe(true)
  })
})

describe('getProgressMessage', () => {
  let calculator: IntelligentProgressCalculator

  beforeEach(() => {
    calculator = new IntelligentProgressCalculator()
  })

  describe('startup phase messages', () => {
    it('returns initializing message', () => {
      expect(calculator.getProgressMessage('startup', { step: 'initializing' })).toBe('Initializing download...')
    })

    it('returns connecting message', () => {
      expect(calculator.getProgressMessage('startup', { step: 'connecting' })).toBe('Connecting to server...')
    })

    it('returns starting message for ready step', () => {
      expect(calculator.getProgressMessage('startup', { step: 'ready' })).toBe('Starting download...')
    })

    it('falls through to ready message when step is undefined', () => {
      expect(calculator.getProgressMessage('startup', {})).toBe('Starting download...')
    })
  })

  describe('downloading phase messages', () => {
    it('returns fetching HTML message with chapter numbers', () => {
      const msg = calculator.getProgressMessage('downloading', {
        chapterIndex: 2,
        totalChapters: 10,
        chapterPhase: 'fetching_html',
      })
      expect(msg).toContain('3')
      expect(msg).toContain('10')
      expect(msg).toContain('Loading page')
    })

    it('returns extracting URLs message with chapter numbers', () => {
      const msg = calculator.getProgressMessage('downloading', {
        chapterIndex: 0,
        totalChapters: 5,
        chapterPhase: 'extracting_urls',
      })
      expect(msg).toContain('1')
      expect(msg).toContain('5')
      expect(msg).toContain('Finding images')
    })

    it('returns downloading images message with image counts', () => {
      const msg = calculator.getProgressMessage('downloading', {
        chapterIndex: 1,
        totalChapters: 3,
        chapterPhase: 'downloading_images',
        imageIndex: 10,
        totalImages: 20,
      })
      expect(msg).toContain('2')
      expect(msg).toContain('3')
      expect(msg).toContain('10')
      expect(msg).toContain('20')
      expect(msg).toContain('Downloading')
    })

    it('returns creating archive message with chapter numbers', () => {
      const msg = calculator.getProgressMessage('downloading', {
        chapterIndex: 4,
        totalChapters: 5,
        chapterPhase: 'creating_archive',
      })
      expect(msg).toContain('5')
      expect(msg).toContain('5')
      expect(msg).toContain('Creating archive')
    })

    it('returns generic processing message for unknown chapter phase', () => {
      const msg = calculator.getProgressMessage('downloading', {
        chapterIndex: 0,
        totalChapters: 1,
        chapterPhase: 'unknown' as never,
      })
      expect(msg).toContain('Processing')
    })
  })

  describe('finalizing phase messages', () => {
    it('returns organizing message', () => {
      expect(calculator.getProgressMessage('finalizing', { step: 'organizing' })).toBe('Organizing files...')
    })

    it('returns cleanup message', () => {
      expect(calculator.getProgressMessage('finalizing', { step: 'cleanup' })).toBe('Cleaning up...')
    })

    it('returns complete message', () => {
      expect(calculator.getProgressMessage('finalizing', { step: 'complete' })).toBe('Download complete!')
    })

    it('falls through to complete message when step is undefined', () => {
      expect(calculator.getProgressMessage('finalizing', {})).toBe('Download complete!')
    })
  })

  it('returns generic processing message for unknown phase', () => {
    expect(calculator.getProgressMessage('unknown' as never, {})).toBe('Processing...')
  })
})
