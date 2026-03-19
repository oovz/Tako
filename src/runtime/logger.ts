// Lightweight structured logger for browser contexts
// Simplified: uses only logLevel (no separate debugMode flag)
import type { AdvancedSettings } from '@/src/storage/settings-types'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LoggerConfig = {
  minLevel: LogLevel
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

// Ref: https://github.com/vitejs/vite/blob/main/docs/guide/env-and-mode.md
const IS_DEV_BUILD = import.meta.env.DEV
const DEFAULT_LOG_LEVEL: LogLevel = IS_DEV_BUILD ? 'debug' : 'warn'

let forceDebug = false
let config: LoggerConfig = { minLevel: DEFAULT_LOG_LEVEL }

export function setLoggerForceDebug(value: boolean): void {
  forceDebug = !!value
  if (forceDebug) {
    config = { minLevel: 'debug' }
  }
}

export function computeLoggerConfig(advanced?: AdvancedSettings): LoggerConfig {
  // Simplified: just use logLevel directly
  if (forceDebug) {
    return { minLevel: 'debug' }
  }
  const minLevel: LogLevel = advanced?.logLevel ?? 'warn'
  return { minLevel }
}

export function applyAdvancedLoggerSettings(advanced?: AdvancedSettings): void {
  config = computeLoggerConfig(advanced)
}

export function configureLogger(next: Partial<LoggerConfig>): void {
  config = { ...config, ...next }
}

export function isDebugLoggingEnabled(): boolean {
  return config.minLevel === 'debug'
}

function shouldWrite(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[config.minLevel]
}

function write(level: LogLevel, msg: string, data?: unknown) {
  if (!shouldWrite(level)) return
  const prefix = `[TMD] ${msg}`
  const payload = data !== undefined ? [prefix, data] : [prefix]
  switch (level) {
    case 'debug':
      return console.debug(...payload)
    case 'info':
      return console.info(...payload)
    case 'warn':
      return console.warn(...payload)
    case 'error':
      return console.error(...payload)
  }
}

export const logger = {
  debug: (msg: string, data?: unknown) => write('debug', msg, data),
  info: (msg: string, data?: unknown) => write('info', msg, data),
  warn: (msg: string, data?: unknown) => write('warn', msg, data),
  error: (msg: string, data?: unknown) => write('error', msg, data),
}

export default logger
