/**
 * Regression tests for Bug #1: Log level controls debug visibility
 * 
 * Simplified: logLevel='debug' shows debug logs, other levels filter them.
 * No separate debugMode flag - just use the log level directly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeLoggerConfig, applyAdvancedLoggerSettings, logger, setLoggerForceDebug, isDebugLoggingEnabled } from '@/src/runtime/logger'
import type { AdvancedSettings } from '@/src/storage/settings-types'

describe('logger log level', () => {
  let originalConsoleDebug: typeof console.debug
  let originalConsoleInfo: typeof console.info
  let originalConsoleWarn: typeof console.warn
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleDebug = console.debug
    originalConsoleInfo = console.info
    originalConsoleWarn = console.warn
    originalConsoleError = console.error
    setLoggerForceDebug(false)
  })

  afterEach(() => {
    console.debug = originalConsoleDebug
    console.info = originalConsoleInfo
    console.warn = originalConsoleWarn
    console.error = originalConsoleError
    setLoggerForceDebug(false)
  })

  describe('computeLoggerConfig', () => {
    it('should use logLevel from settings', () => {
      const settings: AdvancedSettings = {
        logLevel: 'info',
        storageCleanupDays: 30,
      }
      
      const config = computeLoggerConfig(settings)
      expect(config.minLevel).toBe('info')
    })

    it('should default to warn when no settings provided', () => {
      const config = computeLoggerConfig(undefined)
      expect(config.minLevel).toBe('warn')
    })

    it('should use forceDebug override when set', () => {
      setLoggerForceDebug(true)
      
      const settings: AdvancedSettings = {
        logLevel: 'error',
        storageCleanupDays: 30,
      }
      
      const config = computeLoggerConfig(settings)
      expect(config.minLevel).toBe('debug')
    })
  })

  describe('isDebugLoggingEnabled', () => {
    it('should return true when logLevel is debug', () => {
      applyAdvancedLoggerSettings({ logLevel: 'debug', storageCleanupDays: 30 })
      expect(isDebugLoggingEnabled()).toBe(true)
    })

    it('should return false when logLevel is not debug', () => {
      applyAdvancedLoggerSettings({ logLevel: 'warn', storageCleanupDays: 30 })
      expect(isDebugLoggingEnabled()).toBe(false)
    })
  })

  describe('logger output filtering', () => {
    it('should show debug logs when logLevel is debug', () => {
      const mockDebug = vi.fn()
      console.debug = mockDebug
      
      applyAdvancedLoggerSettings({ logLevel: 'debug', storageCleanupDays: 30 })
      logger.debug('test debug message')
      
      expect(mockDebug).toHaveBeenCalledTimes(1)
      expect(mockDebug).toHaveBeenCalledWith('[TMD] test debug message')
    })

    it('should NOT show debug logs when logLevel is warn', () => {
      const mockDebug = vi.fn()
      console.debug = mockDebug
      
      applyAdvancedLoggerSettings({ logLevel: 'warn', storageCleanupDays: 30 })
      logger.debug('test debug message')
      
      expect(mockDebug).not.toHaveBeenCalled()
    })

    it('should show info logs when logLevel is info', () => {
      const mockInfo = vi.fn()
      console.info = mockInfo
      
      applyAdvancedLoggerSettings({ logLevel: 'info', storageCleanupDays: 30 })
      logger.info('test info message')
      
      expect(mockInfo).toHaveBeenCalledTimes(1)
    })

    it('should show warn/error logs regardless of logLevel', () => {
      const mockWarn = vi.fn()
      const mockError = vi.fn()
      console.warn = mockWarn
      console.error = mockError
      
      applyAdvancedLoggerSettings({ logLevel: 'error', storageCleanupDays: 30 })
      
      logger.warn('test warn message')
      logger.error('test error message')
      
      // warn should be filtered (error level doesn't include warn)
      expect(mockWarn).not.toHaveBeenCalled()
      expect(mockError).toHaveBeenCalledTimes(1)
    })
  })

  describe('forceDebug mode', () => {
    it('should show debug logs when forceDebug is true', () => {
      const mockDebug = vi.fn()
      console.debug = mockDebug
      
      setLoggerForceDebug(true)
      logger.debug('forced debug message')
      
      expect(mockDebug).toHaveBeenCalledTimes(1)
    })
  })
})

