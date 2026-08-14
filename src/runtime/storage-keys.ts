export const SESSION_STORAGE_KEYS = {
  queueView: "queueView",
  historyView: "historyView",
  activeTabContextByWindow: "activeTabContextByWindow",
  activeTaskProgress: "activeTaskProgress",
  activeTaskProgressRevision: "activeTaskProgressRevision",
  activeTaskProgressGeneration: "activeTaskProgressGeneration",
  initFailed: "initFailed",
  initError: "error",
  optionsActionItems: "optionsActionItems",
  providerNetworkPolicyContinuation: "providerNetworkPolicyContinuation",
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
} as const

export const STORAGE_KEYS = {
  session: SESSION_STORAGE_KEYS,
  local: LOCAL_STORAGE_KEYS,
  settings: SETTINGS_STORAGE_KEYS,
} as const
