# Tako Manga Downloader

![Tako logo](public/icon/128.png)

Tako is a Chrome extension that keeps manga downloading inside Chrome's Side Panel.

Browse a supported site, choose chapters, queue downloads, and watch progress without juggling popups, extra tabs, or half-finished folders.

## Why Tako

- **Stay on the page**
  Tako works in the Side Panel, so chapter selection, queue management, and progress tracking stay next to the site you are browsing.

- **Keep downloads organized**
  Active tasks, queued work, failures, retries, and recent history live in one place instead of getting scattered across browser prompts.

- **Export in reader-friendly formats**
  Save as CBZ, ZIP, or loose images, use path and filename templates, and include ComicInfo metadata when you want cleaner imports into comic readers and library tools.

- **Use site-specific integrations**
  Supported sites do not share a generic scraper. Each integration handles the metadata, chapter discovery, and image flow that site actually needs.

## Supported sites

| Site | Status | What you can do |
|---|---|---|
| MangaDex | Supported | Filter by language, choose image quality, reuse supported site preferences, and download with rich series metadata. |
| Pixiv Comic | Supported | Download supported chapters from reader pages with the handling needed for protected images and site-specific metadata. |
| Shonen Jump+ | Supported | Download supported chapters from official episode pages with clean metadata defaults for manga readers and libraries. |

Future integrations can be added to the same table with statuses such as `Planned`, `In progress`, or `Supported` once they are scoped.

## Quick start

### Build and load in Chrome

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output\chrome-mv3`.

### Development

```powershell
pnpm dev
```

### Validation

```powershell
pnpm lint
pnpm type-check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
```

## Documentation

If you want to work on the extension, start with the guide that matches the area you are changing:

- `docs/ARCHITECTURE.md` — core runtime, UI, storage, and state flow
- `docs/CONTRIBUTING-SITE-INTEGRATION.md` — adding or maintaining supported-site integrations
- `docs/MESSAGING.md` — runtime message reference and sender rules
- `docs/TEMPLATE-MACROS.md` — filename and path-template macro reference

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

Follow the existing code style and test patterns in the area you are changing. For larger changes, update the relevant docs when behavior, architecture, or contributor workflows change.

## Feedback

If you hit a bug, a site changes behavior, or you have a feature idea, open an issue with the page URL, the affected site, and any error details you can capture.
