# Permissions

Tako requests only the permissions needed for its download, queue, and library organization features.

## Optional `https://*/*` host access

Used specifically for MangaDex. Because MangaDex serves manga pages from dynamic community nodes (MangaDex@Home), host access is requested on demand when you enable MangaDex in Options. If declined or disabled, host access is revoked.

## Fixed host access

Allows network requests to the fixed website, API, and image CDN origins defined by enabled site integrations.

## `storage`

Used to save your settings, active download queue, history, and site preferences locally in your browser profile.

## `unlimitedStorage`

Removes the default local storage quota so that large download queues, extensive history records, and custom templates save reliably without storage errors.

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

Provides periodic background wake-ups to manage queue processing and scheduled tasks reliably across browser sessions.

## `declarativeNetRequestWithHostAccess`

Sets required headers (such as Referer headers) for image servers that require them, strictly scoped to requests made by the extension on supported domains.

## File System Access

Allows you to select a custom local folder where Tako can save your manga directly. Access is granted through a standard browser folder picker, and can be changed or revoked at any time in extension settings.
