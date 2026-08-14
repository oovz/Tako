# Permissions

Tako targets Chrome 150 and requests only the capabilities needed for the
enabled download workflow.

## Optional `https://*/*` host access

Broad HTTPS access is **not** requested at installation. MangaDex is disabled by
default because MangaDex@Home selects image-node origins dynamically and those
origins cannot be fully enumerated in advance.

When the user enables MangaDex in Options, Tako explains the need and calls
`chrome.permissions.request({ origins: ['https://*/*'] })` from that user
gesture. If the user declines, MangaDex remains disabled. Revoking the
permission later makes the integration unavailable; disabling the last
integration that needs it may remove the optional permission.

Even after Chrome grants broad access, Tako's request layer still accepts only
URLs allowed by the active integration's runtime asset policy and revalidates
redirect destinations.

## Fixed host access

Known page, API, and CDN origins for the enabled bundled integrations are listed
explicitly in the manifest/runtime registry. Broad permission is not used as a
substitute for those narrow application policies.

## `unlimitedStorage`

Removes the normal quota from `chrome.storage.local`. Tako stores the durable
queue, history, dispatch lease, pending output identity, destination issues,
settings, and migrations locally in the browser profile.

## `offscreen`

Allows a single hidden extension document to perform provider requests,
rate-limited scheduling, image transforms/descrambling, CBZ/ZIP creation, File
System Access writes, and Blob URL ownership. Offscreen can use only
`chrome.runtime` extension messaging. It remains alive while a Chrome download
still depends on one of its Blob URLs and is closed only when it is otherwise
idle and those downloads are terminal.

## `downloads`

Starts browser-managed file saves and observes `complete | interrupted` state.
The returned `downloadId` means a download was accepted, not that the file is
complete. Tako does not cancel files already handed to Chrome when the broader
task is canceled.

## `scripting`

Allows a bundled, read-only one-shot page probe on a supported page when URL,
provider API, and fetched HTML are insufficient. The probe uses the isolated
world by default, accepts no remote selectors or code, installs no resident
listener, and cannot mutate extension storage or the download queue.

## `webNavigation`

Detects relevant in-page/SPA navigation so Tako can immediately show a loading
state and rerun active-tab context resolution. It does not itself read page
contents.

## `alarms`

Provides a coarse wake-up for offscreen job-lease watchdog checks. The alarm is
explicitly configured to persist across sessions and is verified/recreated
whenever the Service Worker initializes. Native Chrome download completion is
handled by `downloads.onChanged` and startup reconciliation rather than this
watchdog alarm.

## `declarativeNetRequestWithHostAccess`

Applies narrowly scoped request-header rules for provider/CDN requests that need
them. The API can act only where Tako already has host access. Rules are
generated from enabled provider manifests and are additionally restricted to
extension-initiated requests. Because session rules are cleared on browser
shutdown and extension update, DNR-dependent providers wait for reconciliation
before task dispatch. Indeterminate permission/API failures preserve the current
rule set and schedule one capped-backoff retry through `chrome.alarms`.

## File System Access

File System Access is a browser web capability rather than a manifest
permission. Tako exposes it only when the directory picker and handle-permission
APIs are available. A stored handle does not guarantee ongoing authorization;
permission is queried at runtime, and re-grant/reselection must occur from a
visible page under a user gesture. Failure never silently changes a task to
Chrome Downloads.

## Cookies

Tako does not request Chrome's `cookies` permission and does not enumerate,
copy, create, or construct cookie headers. Normal browser credential handling
may attach an origin's cookies to a same-origin request when that integration
declares the appropriate credential mode.
