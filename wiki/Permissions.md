# Permissions

Tako requests only the permissions needed for its download, queue, and library organization features.

## Optional provider host access

Disabled integrations request their declared site, API, and CDN origins when you enable them. MangaDex also declares optional `https://*/*` access because it serves manga pages from dynamic community nodes (MangaDex@Home). If you decline access or disable an integration, Tako revokes optional host access that is no longer needed.

## Fixed host access

Allows network requests to the fixed website, API, and image CDN origins defined by enabled site integrations.

## `storage`

Used to save your settings, active download queue, history, and site preferences locally in your browser profile.

## `unlimitedStorage`

Removes Chrome's default quota for extension local storage, allowing larger download queues and history records.

## `sidePanel`

Allows Tako to open its user interface inside Chrome's Side Panel, enabling you to browse chapters, select downloads, and monitor progress right next to your reading tab.

## `offscreen`

Enables background image downloading, rate limiting, image descrambling, archive packaging (CBZ/ZIP), and local folder writes without blocking the main browser interface.

## `downloads`

Used to save completed chapter files to your computer when using standard Chrome Downloads.

## `tabs`

Reads the active tab's URL and title to detect when you are viewing a supported manga page, allowing Tako to display the correct chapter list in the Side Panel.

## `scripting`

Enables a lightweight, read-only page helper on supported sites when URL and page metadata alone are insufficient to resolve the chapter list.

## `webNavigation`

Detects page navigation and single-page application (SPA) route changes to keep the chapter list updated in the Side Panel.

## `notifications`

Allows Tako to show optional desktop notifications when batch downloads complete or when a task needs your attention.

## `alarms`

Wakes the extension periodically so it can continue queue processing and scheduled work across browser sessions.

## `declarativeNetRequestWithHostAccess`

Sets required request headers, such as `Referer`, for image servers that need them. Rules are scoped to extension requests on supported domains.

## File System Access

Allows you to select a custom local folder where Tako can save your manga directly. Access is granted through a standard browser folder picker, and can be changed or revoked at any time in extension settings.
