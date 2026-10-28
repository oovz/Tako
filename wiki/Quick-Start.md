# Quick Start

[English](Quick-Start) · [日本語](Quick-Start.ja) · [简体中文](Quick-Start.zh-CN) · [繁體中文](Quick-Start.zh-TW) · [한국어](Quick-Start.ko)

## Install Tako

1. Open [Tako on the Chrome Web Store](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) in Chrome 150 or newer.
2. Click **Add to Chrome**.
3. Open Chrome's extensions menu and pin Tako so its icon is easy to find.

<details>
<summary>Install a GitHub release</summary>

1. Open [GitHub Releases](https://github.com/oovz/Tako/releases) and download the Chrome ZIP file for the release you want.
2. Extract it to a folder on your computer.
3. Open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder.

Keep that folder in place while the extension is installed. For a local build, use the [contributor setup guide](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#quick-setup).

</details>

## Download your first chapter

1. Open a manga on a [supported site](Supported-Sites). Most sites use the series page; Shonen Jump+ (少年ジャンプ＋) uses an episode page.
2. Click the Tako icon to open Chrome's Side Panel.
3. Select the chapters you want and click **Download**.
4. Follow progress in the queue. When saving finishes, the result shows **Saved** or **Saved to folder**.

Tako starts with CBZ files saved through Chrome Downloads. You can open a CBZ with a compatible comic reader.

> [!TIP]
> MangaDex is off by default. Enable it in **Options → Site Integrations**, accept Chrome's site-access request, and click **Save Changes** before returning to the series page.

## Choose a format

Open **Settings** from the Side Panel, or right-click the Tako icon and choose **Options**. In **Storage & Files**, choose an archive format and click **Save Changes**.

| Format         | Use it for                                       |
| -------------- | ------------------------------------------------ |
| **CBZ**        | Reading chapters in a comic reader               |
| **ZIP**        | Keeping a chapter's images in a standard archive |
| **No Archive** | Saving individual image files                    |

You can also include a series cover and ComicInfo.xml metadata for compatible readers. [Filename templates](Template-Macros) let you choose how folders and chapter names are organized.

## Choose a save folder

In **Options → Storage & Files**, keep **Use browser downloads** to use Chrome's download location, or choose **Use custom folder (File System Access)** and select a folder. Click **Save Changes** to use that choice for new downloads.

You can change these defaults while a download is running. Tasks already in the queue keep their own folder and requested filenames, including when you retry or restart them. To save a chapter somewhere else, change the default and create a new task.

The optional **Use Chrome Downloads if the folder is unavailable** setting applies to new tasks. It is off by default and can switch destinations only before that task first attempts to write to its selected folder.

## Manage downloads

Tako processes one chapter at a time. You can add more chapters to the queue while it works.

- Use **Retry failed chapters** to try the unfinished parts of a task again. A partially saved chapter starts again from the beginning.
- Use **Restart task** to download every chapter in that task again.
- Use **Cancel download** to stop the task's remaining work. Files already saved stay on disk, and transfers already accepted by Chrome continue in Chrome Downloads.
- Open **Activity & History** in Options to see older tasks and chapter records.

For folder access errors, interrupted work, or **Previously processed** results, see [Troubleshooting](Troubleshooting).
