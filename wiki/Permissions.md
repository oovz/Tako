# Permissions

[English](Permissions) · [日本語](Permissions.ja) · [简体中文](Permissions.zh-CN) · [繁體中文](Permissions.zh-TW) · [한국어](Permissions.ko)

Chrome asks for permissions so Tako can identify a manga, download its images, and save files. This page explains what each permission is used for.

## Website access

Tako needs access to supported sites and their image services to load series information and chapters.

Site access covers supported websites, their APIs and image services, including alternative domains. See [Supported Sites](Supported-Sites) for the pages and domains Tako recognizes.

When a site requires an existing session, Tako can use the browser-managed cookies from your sign-in on that site.

MangaDex is disabled by default. If you enable it in **Options → Site Integrations**, Chrome asks for access to HTTPS sites because MangaDex uses community image servers whose addresses change. If you decline, MangaDex stays disabled.

Optional website access that is no longer needed is removed when you disable the relevant integration. Access included with the extension's fixed site permissions remains declared. You can also review site access in Chrome's extension settings.

## Browser permissions

| Permission                            | Why Tako uses it                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `storage`                             | Keep settings, queue records, and history in your browser profile                             |
| `unlimitedStorage`                    | Allow queue and history records to grow beyond Chrome's default extension-storage quota       |
| `sidePanel`                           | Show chapter selection and download progress beside your reading tab                          |
| `tabs`                                | Read the tab URL and title to identify a supported manga page                                 |
| `webNavigation`                       | Update the chapter list when you move to another page                                         |
| `scripting`                           | Read necessary page information on supported sites when a URL or fetched page is insufficient |
| `offscreen`                           | Process images, create archives, and write to a selected folder in the background             |
| `downloads`                           | Save files through Chrome Downloads and check whether saving finished                         |
| `notifications`                       | Show download notifications when notifications are enabled                                    |
| `alarms`                              | Check ongoing downloads                                                                       |
| `declarativeNetRequestWithHostAccess` | Set headers required by supported image servers, such as the referring page                   |

## Folder access

Choosing a custom folder opens Chrome's folder picker. Tako can then save to that folder and its subfolders. Your folder choice is saved locally for your settings and downloads.

Changing the default folder affects new tasks. Existing tasks keep their original folder, and **Grant access again** renews access to that folder. See [Troubleshooting](Troubleshooting#folder-access-was-lost) if a task cannot save.

## Privacy

Settings, queue records, and download history stay local. Download requests go directly to the supported sites and their image services. Tako runs without developer analytics or a server that receives chapter contents.

When MangaDex is enabled, Tako sends the delivery reports required by MangaDex@Home directly to MangaDex. The [privacy policy](https://github.com/oovz/Tako/blob/main/PRIVACY.md) explains what those reports contain.
