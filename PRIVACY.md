# Privacy Policy

Last updated: November 17, 2026

Tako Manga Downloader is a browser extension for saving chapters from supported manga sites for offline reading. Download controls are available in Chrome’s side panel and Firefox’s sidebar.

## What Tako accesses

While you use the extension, Tako may access:

- Supported-site page URLs and page metadata needed to identify a series or chapter
- Chapter metadata, cover URLs, and image URLs required to build a download
- Browser download APIs and local extension storage used for queue state, settings, and history
- File System Access handles when you choose a custom download folder in Chrome
- Browser-managed credentials for provider and image requests, subject to the browser’s cookie rules

## What Tako stores

The extension stores the following data locally:

- Extension settings
- Queue state, task history, chapter history, and download locations
- Site-specific preferences and overrides
- Up to 10 MiB of local diagnostic entries, with the oldest removed as space is needed. Redaction removes some sensitive values, but entries can still contain titles and URL paths.
- References to folders you choose, kept while your saved settings or downloads need them

## What Tako sends over the network

Tako sends network requests directly to supported sites and their image services to show series information and download chapters.

Cover previews and chapter downloads connect to the site’s image services. Requests may include browser-managed cookies when required by the site, subject to the browser’s cookie rules.

The extension does not collect browsing history, reading activity, or download contents for a developer-run analytics backend.

MangaDex requires Tako to report image download results from MangaDex@Home nodes directly to MangaDex. Each report includes the image URL, whether the download succeeded, the number of bytes transferred, how long it took, and whether the node served it from cache.

MangaDex starts disabled. In Firefox, enabling it asks you to grant site access and allow download reporting. You can revoke reporting in **Add-ons Manager → Tako → Permissions and data**. Revoking it stops reporting and disables the MangaDex integration.

## What Tako does not do

Tako does not:

- Sell personal data
- Run advertising trackers or developer analytics on browsing activity
- Upload downloaded chapter contents to a Tako-operated server
- Unlock paywalled content or create access rights the user does not already have

## User controls

You can:

- Remove the extension at any time
- Clear local task and chapter history.
- View, clear, or export diagnostic entries from Options → Diagnostics. Reports download to your device when you choose **Export JSON**. Review them before sharing.
- Disable supported-site integrations
- Choose a save folder for new tasks in Tako Options on Chrome. Existing Chrome tasks keep their original folder. On Firefox, choose the folder in Firefox Settings.

## Contact

For privacy or policy questions about this repository, open an issue with the relevant details.
