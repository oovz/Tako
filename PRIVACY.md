# Privacy Policy

Last updated: July 20, 2026

Tako Manga Downloader is a browser extension that helps users save chapters from supported manga sites for offline reading workflows inside Chrome's Side Panel.

## What Tako accesses

To perform user-requested actions, Tako may access:

- Supported-site page URLs and page metadata needed to identify a series or chapter
- Chapter metadata, cover URLs, and image URLs required to build a download
- Browser download APIs and local extension storage used for queue state, settings, and history
- File System Access handles only when the user explicitly chooses a custom download folder
- Standard same-origin browser credentials when the browser sends requests to supported sites

## What Tako stores

Tako stores data locally in the browser so the extension can work:

- Extension settings
- Queue state and recent task history
- Site-specific preferences and overrides
- Optional custom-folder permission handles when the user enables that feature

## What Tako sends over the network

Tako makes network requests directly to the supported sites and related infrastructure needed to fulfill the user's requested download workflow. Those requests are not routed through a Tako-operated proxy or analytics service.

The extension does not collect browsing history, reading activity, or download contents for a developer-run analytics backend.

When the disabled-by-default MangaDex integration is explicitly enabled, downloads from MangaDex@Home nodes are reported directly to MangaDex as required by that API. A report may include the full image URL, success status, transferred byte count, transfer duration, and cache status. A reporting failure does not change the requested download result.

## What Tako does not do

Tako does not:

- Sell personal data
- Run advertising trackers or developer analytics on browsing activity
- Upload downloaded chapter contents to a Tako-operated server
- Unlock paywalled content or create access rights the user does not already have

## User controls

Users can:

- Remove the extension at any time
- Clear local history stored by the extension
- Disable supported-site integrations
- Revoke or replace a custom-folder permission by changing browser or extension settings

## Contact

For privacy or policy questions about this repository, open an issue with the relevant details.
