export const SESSION_STORAGE_KEYS = {
  globalState: 'globalState',
  queueView: 'queueView',
  activeTabContext: 'activeTabContext',
  activeTaskProgress: 'activeTaskProgress',
  lastOffscreenActivity: 'lastOffscreenActivity',
  externalTabInitPrefix: 'externalTabInit_',
  pendingDownloads: 'pendingDownloads',
  initFailed: 'initFailed',
  initError: 'error',
} as const

export const SETTINGS_STORAGE_KEYS = {
  global: 'settings:global',
} as const

export const LOCAL_STORAGE_KEYS = {
  downloadQueue: 'downloadQueue',
  fsaError: 'fsaError',
  settings: SETTINGS_STORAGE_KEYS.global,
} as const

export const STORAGE_KEYS = {
  session: SESSION_STORAGE_KEYS,
  local: LOCAL_STORAGE_KEYS,
  settings: SETTINGS_STORAGE_KEYS,
} as const
