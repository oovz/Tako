export const SESSION_STORAGE_KEYS = {
  globalState: "globalState",
  queueView: "queueView",
  historyView: "historyView",
  activeTabContext: "activeTabContext",
  activeTabContextByWindow: "activeTabContextByWindow",
  activeTaskProgress: "activeTaskProgress",
  activeTaskProgressRevision: "activeTaskProgressRevision",
  activeTaskProgressGeneration: "activeTaskProgressGeneration",
  pendingDownloads: "pendingDownloads",
  initFailed: "initFailed",
  initError: "error",
  optionsActionItems: "optionsActionItems",
} as const

export const SETTINGS_STORAGE_KEYS = {
  global: "settings:global",
} as const

export const LOCAL_STORAGE_KEYS = {
  downloadQueue: "downloadQueue",
  destinationIssues: "destinationIssues",
  settings: SETTINGS_STORAGE_KEYS.global,
  downloadedChapters: "downloadedChapters",
  seriesDownloadHistory: "seriesDownloadHistory",
  downloadHistoryClearCutoffs: "downloadHistoryClearCutoffs",
  persistentErrors: "persistent_errors",
  activeDispatchLease: "activeDispatchLease",
  pendingOutputs: "pendingOutputs",
  pendingUndoActions: "pendingUndoActions",
  progressTimingEstimates: "progressTimingEstimates",
  commandResults: "commandResults",
} as const

export const STORAGE_KEYS = {
  session: SESSION_STORAGE_KEYS,
  local: LOCAL_STORAGE_KEYS,
  settings: SETTINGS_STORAGE_KEYS,
} as const
