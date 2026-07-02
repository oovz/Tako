# Permissions

Permissions requested by Tako and what each is used for.

## `<all_urls>` (host permission)

Grants access to fetch manga pages and images from the five supported sites and their CDNs.

Four of the five supported sites serve images from fixed CDN domains. MangaDex uses MangaDex@home, a volunteer-run CDN. The MangaDex API returns the image server domain at runtime per chapter, and the domain cannot be predicted or enumerated in the manifest.

## `unlimitedStorage`

Removes the 10 MB default quota on `chrome.storage.local`. Tako stores download history and queue state in extension storage.

## `offscreen`

Allows Tako to create an offscreen document for building ZIP/CBZ archives and processing images. The service worker cannot access DOM APIs or perform heavy computation. The offscreen document is closed when the download finishes.

## `scripting`

Allows Tako to inject scripts into supported manga pages on demand to extract chapter lists and metadata. Used when a page navigates or updates via SPA routing. Scripts are injected only into supported sites.

## `webNavigation`

Allows Tako to detect in-page navigations on SPA manga sites, where the URL changes without a page reload. Tako re-scans for manga data when navigation occurs.

## `alarms`

Allows Tako to wake the service worker periodically during long downloads. Chrome terminates idle service workers after 30 seconds. `chrome.alarms` is the recommended mechanism for scheduled work in MV3 service workers.

## `declarativeNetRequest`

Allows Tako to set the `Referer` header on image requests to CDNs that require it. Rules are scoped to specific CDN domains.

## `cookies`

Allows Tako to read and forward session cookies for Pixiv Comic image requests. Pixiv Comic serves some content only to logged-in users. Cookies are passed through to the same origin they came from.
