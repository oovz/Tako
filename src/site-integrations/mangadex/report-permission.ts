export const MANGADEX_REPORTING_DATA_TYPE = "websiteActivity"

export type FirefoxPermissions = chrome.permissions.Permissions & {
  data_collection?: string[]
}

export function includesMangadexReportingPermission(
  permissions: FirefoxPermissions
): boolean {
  return (
    !!import.meta.env.FIREFOX &&
    permissions.data_collection?.includes(MANGADEX_REPORTING_DATA_TYPE) === true
  )
}

export function hasMangadexReportingConsent(): Promise<boolean> {
  const permissions: FirefoxPermissions = {
    data_collection: [MANGADEX_REPORTING_DATA_TYPE],
  }
  return chrome.permissions.contains(permissions)
}
