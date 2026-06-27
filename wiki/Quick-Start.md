# Quick Start

## Install from the Chrome Web Store

1. Open the [Tako page on the Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb).
2. Click **Add to Chrome**.
3. Pin Tako from the extensions menu for quick access.

## Install from source

<details>
<summary>From GitHub Releases</summary>

1. Go to the repository **Releases** page and download the latest `tako-manga-downloader-vX.Y.Z-chrome.zip`.
2. Extract the zip to a folder on your machine.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the extracted folder.

</details>

<details>
<summary>Build locally</summary>

```powershell
pnpm install
pnpm build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `.output\chrome-mv3`.

</details>

## Download your first chapter

1. Open a supported series page on any of the [supported sites](Supported-Sites).
2. Click the Tako icon to open the Side Panel.
3. Tako detects the series and lists available chapters.
4. Select the chapters you want.
5. Click **Download**.
6. Watch progress in the queue. Completed chapters appear in your download folder as CBZ, ZIP, or image folders depending on your settings.

## Change output format or save location

1. Right-click the Tako icon and choose **Options**, or open the Side Panel menu and select **Settings**.
2. Under **Output**, pick CBZ, ZIP, or loose images.
3. Optionally set a custom download folder using File System Access.
4. Adjust path and filename templates — see [Template Macros](Template-Macros) for the full reference.

## Queue and retry

- Tako processes one chapter at a time.
- Failed images retry automatically based on your rate-limit and retry settings.
- You can retry failed chapters or restart a task from the queue.
- The Side Panel shows recent activity; the Options page shows full history.
