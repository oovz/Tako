import { describe, expect, it } from 'vitest'

import {
  STORAGE_KEYS,
  SESSION_STORAGE_KEYS,
  LOCAL_STORAGE_KEYS,
  SETTINGS_STORAGE_KEYS,
} from '@/src/runtime/storage-keys'

describe('storage-keys', () => {
  it('defines required session storage keys', () => {
    expect(SESSION_STORAGE_KEYS.globalState).toBe('globalState')
    expect(SESSION_STORAGE_KEYS.queueView).toBe('queueView')
    expect(SESSION_STORAGE_KEYS.activeTabContext).toBe('activeTabContext')
    expect(SESSION_STORAGE_KEYS.activeTaskProgress).toBe('activeTaskProgress')
    expect(SESSION_STORAGE_KEYS.lastOffscreenActivity).toBe('lastOffscreenActivity')
    expect(SESSION_STORAGE_KEYS.externalTabInitPrefix).toBe('externalTabInit_')
    expect(SESSION_STORAGE_KEYS.pendingDownloads).toBe('pendingDownloads')
    expect(SESSION_STORAGE_KEYS.initFailed).toBe('initFailed')
    expect(SESSION_STORAGE_KEYS.initError).toBe('error')
  })

  it('defines required local storage keys', () => {
    expect(LOCAL_STORAGE_KEYS.downloadQueue).toBe('downloadQueue')
    expect(LOCAL_STORAGE_KEYS.fsaError).toBe('fsaError')
    expect(LOCAL_STORAGE_KEYS.settings).toBe('settings:global')
  })

  it('defines the canonical local settings storage key', () => {
    expect(SETTINGS_STORAGE_KEYS.global).toBe('settings:global')
  })

  it('exposes grouped constants in STORAGE_KEYS', () => {
    expect(STORAGE_KEYS.session).toBe(SESSION_STORAGE_KEYS)
    expect(STORAGE_KEYS.local).toBe(LOCAL_STORAGE_KEYS)
    expect(STORAGE_KEYS.settings).toBe(SETTINGS_STORAGE_KEYS)
  })
})

