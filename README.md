<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako Manga Downloader

Download chapters from supported manga sites through Chrome's Side Panel and
save them as CBZ, ZIP, or image files.

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[Get started](#get-started) · [Supported sites](#supported-sites) ·
[Development](#development) · [Wiki](https://github.com/oovz/Tako/wiki) ·
[Privacy](#privacy)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md)
· [日本語](README.ja.md)

</div>

---

## What Tako does

- Lists chapters from the current series page in Chrome's Side Panel.
- Runs one download task at a time and keeps the remaining tasks in a durable
  queue.
- Retries failed chapter work and records completed, partial, failed, and
  canceled tasks.
- Saves through Chrome Downloads by default. A selected local folder is also
  supported through the File System Access API.
- Generates CBZ or ZIP archives, loose image output, and optional
  `ComicInfo.xml` metadata.
- Supports global settings and per-site overrides for paths, filenames, rate
  limits, retries, and output format.

Tako does not provide access to content that the current browser session cannot
already read. It is not intended to bypass paywalls, login restrictions, DRM, or
copyright controls.

## Supported sites

| Site                                        | Notes                                               |
| ------------------------------------------- | --------------------------------------------------- |
| [MangaDex](https://mangadex.org)            | Disabled by default; requests optional HTTPS access |
| [Pixiv Comic](https://comic.pixiv.net)      | Supported                                           |
| [Shonen Jump+](https://shonenjumpplus.com)  | Start from a numeric `/episode/{id}` page           |
| [Manhuagui](https://www.manhuagui.com)      | Supported                                           |
| [Comic Nettai](https://www.comicnettai.com) | Supported                                           |

The Shonen Jump+ homepage and `/series` catalog routes are not downloadable
series contexts. For integration details or a new-site request, see the
[Supported Sites](https://github.com/oovz/Tako/wiki/Supported-Sites) page and
[Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide).

## Get started

1. Install Tako from the
   [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
2. Open a supported series page.
3. Click the Tako icon to open the Side Panel.
4. Select chapters and click **Download**.
5. Follow the task in the queue. The Options page contains full history and
   destination recovery actions.

The [Quick Start guide](https://github.com/oovz/Tako/wiki/Quick-Start) covers
output formats, custom folders, and retry controls.

### Install an unpacked build

Tako currently targets Chrome 150 or newer. Local builds require Node.js 20.19
or newer (or Node.js 22.12 or newer) and pnpm 10.32.1.

```powershell
pnpm install
pnpm build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**,
and select `.output\chrome-mv3`.

Release archives are available from the repository's Releases page. Extract a
Chrome archive before selecting it with **Load unpacked**.

## Development

Common commands:

```powershell
pnpm dev
pnpm lint
pnpm type-check
pnpm format:check
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm check:site-integrations
pnpm audit --prod --audit-level=high
```

The full dependency-graph checker needs the JSON report and the audit process's
exit code. Generate both before comparing the report with the reviewed baseline:

```powershell
pnpm audit --json | Out-File -Encoding utf8 dependency-audit.json
$auditExit = $LASTEXITCODE
pnpm check:dependency-audit -- dependency-audit.json .github/dependency-audit-baseline.json $auditExit
```

Build and test artifacts are separated by mode:

| Mode              | Command          | Output                         |
| ----------------- | ---------------- | ------------------------------ |
| Production        | `pnpm build`     | `.output\chrome-mv3`           |
| Deterministic E2E | `pnpm test:e2e`  | `.output\chrome-mv3-e2e-test`  |
| Live E2E          | `pnpm test:live` | `.output\chrome-mv3-live-test` |

Only the production build is suitable for release. Test builds contain
mode-specific state seeding or request routing and must not be distributed.

The architecture is at the Phase 2 checkpoint with selected Phase 3 work in
place. Queue and output state are durable, while the larger repository and
transition-kernel extraction remains incomplete. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the working agreement and validation
sequence.

## Runtime outline

The Manifest V3 Service Worker owns durable state and privileged Chrome APIs.
The Side Panel and Options page send validated commands and render stored
projections. An offscreen document handles provider data, image processing,
archive creation, File System Access writes, and Blob-backed handoff to Chrome
Downloads. Provider code is registered from the typed site-integration manifest.

See [Architecture](https://github.com/oovz/Tako/wiki/Architecture) for the job,
restart, and native-output protocols.

## Troubleshooting

- **MangaDex is unavailable:** enable MangaDex in Options and approve the
  optional HTTPS permission when Chrome asks. Disabling it removes that access.
- **A custom folder needs attention:** open **Options → Downloads** and grant
  access again, select another folder, continue that task through Chrome
  Downloads, or cancel it. Tako does not switch destinations silently.
- **Chrome download history was erased before Tako saw completion:** the task
  reports an unobservable browser download. Use the task-wide forget action only
  when Chrome no longer needs any pending output from that task.
- **An unpacked build does not load:** verify Chrome 150+, rebuild with the
  supported Node and pnpm versions, and select `.output\chrome-mv3` rather than
  the repository root or an E2E artifact.

## Documentation

- [Quick Start](https://github.com/oovz/Tako/wiki/Quick-Start)
- [Supported Sites](https://github.com/oovz/Tako/wiki/Supported-Sites)
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros)
- [Architecture](https://github.com/oovz/Tako/wiki/Architecture)
- [Permissions](https://github.com/oovz/Tako/wiki/Permissions)
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)

## Privacy

Settings, queue state, and history stay in browser storage. Tako has no
developer-operated analytics or telemetry service. Requests go to the enabled
site integrations and their required infrastructure. When MangaDex is enabled,
its MangaDex@Home delivery report is sent directly to MangaDex.

See [PRIVACY.md](PRIVACY.md) for the complete policy.
