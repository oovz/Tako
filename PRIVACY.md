# Privacy Policy

Last updated: September 14, 2026

Tako Manga Downloader is a browser extension for saving chapters from supported manga sites for offline reading. Download controls are available in Chrome's Side Panel.

## What Tako accesses

While you use the extension, Tako may access:

- Supported-site page URLs and page metadata needed to identify a series or chapter
- Chapter metadata, cover URLs, and image URLs required to build a download
- Browser download APIs and local extension storage used for queue state, settings, and history
- File System Access handles only when the user explicitly chooses a custom download folder
- Browser-managed credentials for provider and image requests, subject to Chrome's cookie rules

## What Tako stores

The extension stores the following data locally:

- Extension settings
- Queue state and recent task history
- Site-specific preferences and overrides
- Optional custom-folder permission handles when the user enables that feature

## What Tako sends over the network

Tako sends network requests directly to supported sites and their image services to show series information and download chapters.

Cover previews use Chrome's image loading. These requests can include cookies for the image host and follow redirects under the browser's rules. Download requests use each integration's configured credential and redirect policy.

The extension does not collect browsing history, reading activity, or download contents for a developer-run analytics backend.

When you enable the disabled-by-default MangaDex integration, downloads from MangaDex@Home nodes are reported directly to MangaDex as required by that API. A report may include the full image URL, success status, transferred byte count, transfer duration, and cache status. A reporting failure does not change the requested download result.

## What Tako does not do

Tako does not:

- Sell personal data
- Run advertising trackers or developer analytics on browsing activity
- Upload downloaded chapter contents to a Tako-operated server
- Unlock paywalled content or create access rights the user does not already have

## User controls

You can:

- Remove the extension at any time
- Clear local history stored by the extension
- Disable supported-site integrations
- Revoke or replace a custom-folder permission by changing browser or extension settings

## Contact

For privacy or policy questions about this repository, open an issue with the relevant details.
