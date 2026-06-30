import { vi } from 'vitest'

export interface ChromeStorageMockOptions {
  localData?: Record<string, unknown>
  sessionData?: Record<string, unknown>
  includeOnChanged?: boolean
}

export interface ChromeStorageMock {
  local: Record<string, unknown>
  session: Record<string, unknown>
  localOnChangedListeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>
  sessionOnChangedListeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>
  mocks: Array<{ mockClear: () => void }>
  restore: () => void
}

function createStorageArea(
  data: Record<string, unknown>,
  onChangedListeners: Array<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void>,
  areaName: string,
) {
  return {
    get: vi.fn((keys?: string | string[] | null) => {
      if (keys === undefined || keys === null) {
        return Promise.resolve({ ...data })
      }
      const keyArray = Array.isArray(keys) ? keys : [keys]
      const result: Record<string, unknown> = {}
      for (const key of keyArray) {
        if (key in data) {
          result[key] = data[key]
        }
      }
      return Promise.resolve(result)
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const [key, newValue] of Object.entries(items)) {
        const oldValue = data[key]
        data[key] = newValue
        changes[key] = { oldValue, newValue }
      }
      for (const listener of onChangedListeners) {
        listener(changes, areaName)
      }
      return Promise.resolve()
    }),
    remove: vi.fn((keys: string | string[]) => {
      const keyArray = typeof keys === 'string' ? [keys] : keys
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const key of keyArray) {
        if (key in data) {
          changes[key] = { oldValue: data[key], newValue: undefined }
          delete data[key]
        }
      }
      for (const listener of onChangedListeners) {
        listener(changes, areaName)
      }
      return Promise.resolve()
    }),
    clear: vi.fn(() => {
      for (const key of Object.keys(data)) {
        delete data[key]
      }
      return Promise.resolve()
    }),
  }
}

export function createChromeStorageMock(options: ChromeStorageMockOptions = {}): ChromeStorageMock {
  const localData: Record<string, unknown> = { ...options.localData }
  const sessionData: Record<string, unknown> = { ...options.sessionData }
  const localOnChangedListeners: ChromeStorageMock['localOnChangedListeners'] = []
  const sessionOnChangedListeners: ChromeStorageMock['sessionOnChangedListeners'] = []

  const local = createStorageArea(localData, localOnChangedListeners, 'local')
  const session = createStorageArea(sessionData, sessionOnChangedListeners, 'session')

  const storage: Record<string, unknown> = {
    local,
    session,
  }

  const collectedMocks: Array<{ mockClear: () => void }> = [
    local.get, local.set, local.remove, local.clear,
    session.get, session.set, session.remove, session.clear,
  ]

  if (options.includeOnChanged) {
    const addListener = vi.fn((callback: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void) => {
      localOnChangedListeners.push((changes, area) => {
        if (area === 'local') callback(changes, area)
      })
      sessionOnChangedListeners.push((changes, area) => {
        if (area === 'session') callback(changes, area)
      })
    })
    const removeListener = vi.fn()
    storage.onChanged = { addListener, removeListener }
    collectedMocks.push(addListener, removeListener)
  }

  const setAccessLevel = vi.fn().mockResolvedValue(undefined)
  ;(session as Record<string, unknown>).setAccessLevel = setAccessLevel
  collectedMocks.push(setAccessLevel)

  const previous = (globalThis as { chrome?: unknown }).chrome

  ;(globalThis as { chrome?: unknown }).chrome = {
    ...(previous as object | undefined),
    storage,
  }

  return {
    local: localData,
    session: sessionData,
    localOnChangedListeners,
    sessionOnChangedListeners,
    mocks: collectedMocks,
    restore: () => {
      ;(globalThis as { chrome?: unknown }).chrome = previous
    },
  }
}

export function resetChromeStorageMock(mock: ChromeStorageMock): void {
  for (const key of Object.keys(mock.local)) {
    delete mock.local[key]
  }
  for (const key of Object.keys(mock.session)) {
    delete mock.session[key]
  }
  mock.localOnChangedListeners.length = 0
  mock.sessionOnChangedListeners.length = 0
  for (const fn of mock.mocks) {
    fn.mockClear()
  }
}
