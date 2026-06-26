![Tako promo banner](assets/store/marquee-promo-1400x560.png)

# Tako Manga Downloader

Tako is a Chrome extension that keeps chapter selection, queue management, and organized exports inside Chrome's Side Panel.

Instead of juggling extra tabs, repeated save dialogs, or brittle one-off scripts, you can review chapters, queue downloads, watch progress, and export cleaner offline-reading files from one workflow.

<p>
  <a href="https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb">
    <img
      src="https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png"
      alt="Available in the Chrome Web Store"
      width="170"
    />
  </a>
</p>



## Why Tako

- **Stay in your reading flow**  
  The Side Panel keeps chapter selection and queue controls next to the page you are already on.
- **Use a real queue instead of one-off saves**  
  Active work, queued jobs, retries, and recent results stay together in one command center.
- **Export cleaner files**  
  Save as CBZ, ZIP, or image folders with path and filename templates that work better with reader apps and library tools.
- **Optimized site-support instead of generic scraping**  
  Integrations apply site-specific metadata, image handling, and queue behavior where the extension explicitly supports a site.
- **Tune everything from one settings page**  
  Global defaults and per-site overrides live in the options page instead of scattered browser prompts.

## Supported sites

| Site | Status |
|---|---|
| MangaDex | ✅ |
| Pixiv Comic | ✅ |
| Shonen Jump+ | ✅ |
| Manhuagui | ✅ |
| Comic Nettai | ✅ |

## Rights and site access

Tako is intended for pages you can already access in your own browser session on supported sites.

- It is **not** a tool for bypassing paywalls, login restrictions, DRM, or copyright controls.
- It does **not** grant access rights you do not already have.

## Get started

The fastest way to try Tako:

1. Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
2. Open a supported series page.
3. Click the Tako icon to open the Side Panel.
4. Select chapters, click Download, and watch the queue.

## Install from source

### From GitHub Releases

1. Open the repository **Releases** page and download the latest `tako-manga-downloader-vX.Y.Z-chrome.zip` asset.
2. Extract the zip to a folder on your machine.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted extension folder.

Chrome will load Tako from that folder. You can pin it from the extensions menu if needed.

### Build locally and load in Chrome

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output\chrome-mv3`.

### Development

```powershell
pnpm dev
```

## Documentation

- [Architecture](https://github.com/oovz/Tako/wiki/Architecture) — core runtime, storage, messaging, and state flow
- [Site Integration Guide](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) — adding or maintaining supported-site integrations
- [Template Macros](https://github.com/oovz/Tako/wiki/Template-Macros) — filename and path-template macro reference
- [Quick Start](https://github.com/oovz/Tako/wiki/Quick-Start) — installation and first download walkthrough
- [Supported Sites](https://github.com/oovz/Tako/wiki/Supported-Sites) — current site integrations and status
- [Comparisons](https://github.com/oovz/Tako/wiki/Comparisons) — how Tako compares to other manga downloaders

## Privacy

Tako stores settings, queue state, and history locally in the browser so the extension can function. Network requests are made directly to supported sites and related infrastructure needed for the user's requested workflow; the extension does not run a developer analytics backend for browsing history or downloaded chapter contents.

See [`PRIVACY.md`](PRIVACY.md) for the current privacy policy text.

## Contributing

We welcome contributions from the community. Please read the [`contributing guidelines`](CONTRIBUTING.md) before submitting a pull request.
