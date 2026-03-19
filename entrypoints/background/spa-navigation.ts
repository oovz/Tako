export type SpaNavigationAction = 'clear-tab-state' | 'noop'

export interface ResolveSpaNavigationActionOptions {
  isUrlSupported: boolean
  hasExistingTabState: boolean
}

export function resolveSpaNavigationAction(
  options: ResolveSpaNavigationActionOptions,
): SpaNavigationAction {
  const { isUrlSupported, hasExistingTabState } = options

  if (isUrlSupported) {
    return 'noop'
  }

  if (hasExistingTabState) {
    return 'clear-tab-state'
  }

  return 'noop'
}
