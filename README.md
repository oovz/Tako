# Tako Manga Downloader

Tako is a Chrome extension for downloading manga without turning the browser into a mess of tabs, prompts, and half-finished folders.

It lives in Chrome's Side Panel, so you can stay on the site you're reading, choose the chapters you want, queue downloads, and keep an eye on progress from the same place.

## Highlights

- **Side Panel workflow**
  Tako stays beside the page instead of disappearing like a popup, which makes it much easier to browse, select, and download in one pass.

- **Queue and history built in**
  Active downloads, queued work, failures, retries, and recent history all live in the same interface.

- **Library-friendly output**
  Export as CBZ, ZIP, or loose images, use path and filename templates, and include ComicInfo metadata when you want cleaner imports into comic readers and library tools.

- **Site-specific handling**
  Supported sites do not share a one-size-fits-all scraper. Each integration handles the reader, metadata, and image flow it actually needs.

## Supported sites

- **MangaDex**
  Supports rich metadata, language filtering, image-quality controls, and optional reuse of your MangaDex website preferences.

- **Pixiv Comic**
  Supports Pixiv Comic viewer flows, authenticated requests where needed, and image reconstruction for supported protected content flows.

- **Shonen Jump+**
  Supports official episode pages with integration-specific image handling and manga-friendly metadata defaults.

## Getting started

### Load Tako locally in Chrome

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output\chrome-mv3`.

### Development

```powershell
pnpm dev
```

## Roadmap

- **Richer chapter status cues**
  Make it easier to see what is queued, finished, failed, or already downloaded before starting another run.

- **Smarter custom-folder conflict handling**
  Improve unique-name behavior when files or folders already exist in user-selected destinations.

- **Clearer post-download verification**
  Surface browser-level download interruptions more clearly after files are handed off to Chrome.

- **Better behavior on slow connections**
  Reduce false recovery signals during unusually long image downloads.

- **More efficient large download sessions**
  Reuse repeat assets such as cover images more intelligently across long runs.

## Contributing

If you want to contribute, start with the guide that matches the area you're changing:

- `docs/ARCHITECTURE.md` — core runtime, UI, storage, and state flow
- `docs/CONTRIBUTING-SITE-INTEGRATION.md` — adding or maintaining supported-site integrations
- `docs/MESSAGING.md` — runtime message reference and sender rules
- `docs/TEMPLATE-MACROS.md` — filename and path-template macro reference
- `docs/README.md` — contributor documentation index

If you hit a bug, a site changes behavior, or you have a feature idea, open an issue with the page URL, the affected site, and any error details you can capture.
