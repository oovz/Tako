import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { applyAdvancedLoggerSettings, logger, setLoggerForceDebug } from '@/src/runtime/logger'
import type { AdvancedSettings } from '@/src/storage/settings-types'

const baseSettings: AdvancedSettings = {
  logLevel: 'info',
  storageCleanupDays: 30,
}

const makeSettings = (overrides: Partial<AdvancedSettings>): AdvancedSettings => ({
  ...baseSettings,
  ...overrides,
})

describe('logger', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    setLoggerForceDebug(false)
    applyAdvancedLoggerSettings(baseSettings)
  })

  afterEach(() => {
    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    setLoggerForceDebug(false)
  })

  it('respects logLevel setting', () => {
    applyAdvancedLoggerSettings(makeSettings({ logLevel: 'info' }))

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('filters output based on logLevel', () => {
    applyAdvancedLoggerSettings(makeSettings({ logLevel: 'error' }))

    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('forces debug logging when debug is forced', () => {
    setLoggerForceDebug(true)
    applyAdvancedLoggerSettings(makeSettings({ logLevel: 'error' }))

    logger.debug('debug message')
    logger.info('info message')

    expect(debugSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy).toHaveBeenCalledTimes(1)
  })
})

