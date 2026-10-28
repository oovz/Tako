# Troubleshooting

[English](Troubleshooting) · [日本語](Troubleshooting.ja) · [简体中文](Troubleshooting.zh-CN) · [繁體中文](Troubleshooting.zh-TW) · [한국어](Troubleshooting.ko)

Find the message or situation below. For your first download, start with [Quick Start](Quick-Start).

## The chapter list won't load

1. Check that you're on a [supported page](Supported-Sites). Most sites need the series or book page; Shonen Jump+ (少年ジャンプ＋) uses an episode page.
2. Check **Options → Site Integrations** to make sure the site is enabled. MangaDex also needs you to accept Chrome's site-access request and save the change.
3. If the panel shows **Couldn't load this series**, click **Retry series**.

If the problem remains, open the page normally and check whether the site itself is available. Chapter access can also depend on your account or region.

## What do the save results mean?

| Result                   | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| **Saved**                | Tako received confirmation that Chrome finished saving the required files                        |
| **Saved to folder**      | The required files were written and closed in the selected folder                                |
| **Previously processed** | A record of earlier processing exists, but final saving was not confirmed                        |
| **Failed / Partial**     | The task ended before all requested output was saved; check the task's error and chapter results |
| **Skipped**              | That chapter was not processed, for example after cancellation or a folder-save failure          |

**Saved** records the result at the time of saving. Check Chrome Downloads or the task’s folder for its current location; files may have been moved or deleted afterward.

## Tako is waiting for Chrome Downloads

Open Chrome Downloads and look for a paused transfer or a save dialog that needs your response. Tako waits for Chrome's final result before marking the chapter saved.

If Tako says saving **could not be confirmed**, check Chrome Downloads and your save folder before retrying. A file may already exist. The retry or restart action warns that it may create duplicates.

## Folder access was lost

1. Find the failed task in the Side Panel or **Options → Activity & History**.
2. Open its folder actions and choose **Grant access again**.
3. After access is restored, choose **Retry failed chapters** or **Restart task**.

Granting access restores permission for that task’s original folder. Retry or restart the task after restoring access.

If its original destination is unavailable, choose a folder in **Options → Storage & Files**, click **Save Changes**, and create a new task. Existing tasks keep their captured destination.

## A download failed or saved only some files

Tako retries download failures according to your retry settings. If a task still fails, check the reported error before trying again.

- **Retry failed chapters**, when available, keeps completed chapters and tries failed, partially saved, and eligible skipped chapters again. A partially saved chapter starts from the beginning.
- **Restart task** tries every chapter again.

Both actions retain the task's requested paths and effective save location. Existing files are handled using the task's file-conflict setting, so review partial output before retrying.

A folder-save error ends the task and skips the remaining chapters. Already saved files stay on disk. The optional **Use Chrome Downloads if the folder is unavailable** setting must be enabled before creating a task; it can switch destinations only before that task first attempts to write to its folder.

## Work was interrupted by a browser restart

Tako restores queue and history records when it starts and checks work that may still be running. After a full browser restart, unfinished images and archives need to be downloaded again. Use **Retry failed chapters** for unfinished chapters or **Restart task** to try the full selection again.

If saving is unconfirmed, check for existing files first to avoid duplicates.

## Canceling didn't stop a Chrome transfer

Canceling a task stops Tako's remaining processing and future chapters. Downloads Chrome has already accepted continue. Pause or cancel those transfers in Chrome Downloads. Files already saved remain on disk.

## Clear history without deleting files

In **Options → Activity & History**, use **Clear task history** to remove finished, failed, and canceled task records. Use **Clear chapter history** to remove chapter records for all series.

The controls work independently: clearing task history preserves chapter history, and both leave downloaded files on disk.

## Report a problem

[Open a bug report](https://github.com/oovz/Tako/issues/new?template=bug_report.md) with your Tako version, Chrome version, site, a public series URL, the visible message, and the steps that led to it. Leave out account credentials and private download links.
