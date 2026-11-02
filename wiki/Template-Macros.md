# Template Macros

[English](Template-Macros) · [日本語](Template-Macros.ja) · [简体中文](Template-Macros.zh-CN) · [繁體中文](Template-Macros.zh-TW) · [한국어](Template-Macros.ko)

Templates choose the folders and names Tako uses for downloaded chapters. A macro is a placeholder such as `<SERIES_TITLE>` that Tako replaces with information about the manga.

## Start with the defaults

Open **Options → Storage & Files**. The two template fields are:

| Field                       | Default              | What it controls                                                      |
| --------------------------- | -------------------- | --------------------------------------------------------------------- |
| **Directory Path Template** | `TMD/<SERIES_TITLE>` | Folders beneath your download location                                |
| **Filename Template**       | `<CHAPTER_TITLE>`    | The chapter archive name, or the chapter folder for individual images |

For a series called _Example Manga_ and a chapter called _Chapter 1_, the defaults produce:

```text
TMD/Example Manga/Chapter 1.cbz
```

Choose the format separately. Tako adds `.cbz` or `.zip` automatically. With **No Archive**, the chapter name becomes a folder containing the images.

Use `/` between folders in the directory field. Putting `.cbz` in that field creates a folder with that suffix.

## Patterns to try

| Goal                       | Directory template                  | Filename template                            |
| -------------------------- | ----------------------------------- | -------------------------------------------- |
| Group by series            | `TMD/<SERIES_TITLE>`                | `<CHAPTER_TITLE>`                            |
| Group by site, then series | `<INTEGRATION_NAME>/<SERIES_TITLE>` | `<CHAPTER_TITLE>`                            |
| Group by month downloaded  | `<YYYY>/<MM>/<SERIES_TITLE>`        | `<CHAPTER_TITLE>`                            |
| Add chapter numbers        | `TMD/<SERIES_TITLE>`                | `Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>` |

Numbered names depend on the site providing a chapter number. Use the title-based default if it doesn't.

## Available macros

### Date macros

These use your local date when the task is created. Retry and Restart keep the original requested path, even on another day.

| Macro    | Meaning         | Example |
| -------- | --------------- | ------- |
| `<YYYY>` | Four-digit year | `2026`  |
| `<MM>`   | Two-digit month | `05`    |
| `<DD>`   | Two-digit day   | `12`    |

### Site and series macros

| Macro                | Meaning                             | Availability                   |
| -------------------- | ----------------------------------- | ------------------------------ |
| `<INTEGRATION_NAME>` | Site identifier, such as `mangadex` | Available for queued downloads |
| `<SERIES_TITLE>`     | Manga or series title               | Available for queued downloads |
| `<PUBLISHER>`        | Publisher name                      | Depends on the site's metadata |

### Chapter and volume macros

| Macro                   | Meaning                                        | Example                             |
| ----------------------- | ---------------------------------------------- | ----------------------------------- |
| `<CHAPTER_TITLE>`       | Chapter title                                  | `Chapter 1`                         |
| `<CHAPTER_NUMBER>`      | Chapter number                                 | `15.5`                              |
| `<CHAPTER_NUMBER_PAD2>` | Chapter number padded to at least two digits   | `01`                                |
| `<CHAPTER_NUMBER_PAD3>` | Chapter number padded to at least three digits | `001`                               |
| `<VOLUME_NUMBER>`       | Volume number                                  | `5`                                 |
| `<VOLUME_NUMBER_PAD2>`  | Volume number padded to at least two digits    | `05`                                |
| `<VOLUME_TITLE>`        | Volume label                                   | Currently empty in queued downloads |

Chapter titles are available for queued downloads. Chapter and volume numbers depend on the site's metadata. The template editor recognizes `<VOLUME_TITLE>`, but queued downloads currently leave it empty; use numeric volume macros when available.

## Missing values

An unavailable value becomes empty text. Tako drops empty folder segments, but surrounding filename text remains. For example, `Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>` can become `Ch. - Chapter 1` when there is no chapter number.

The preview uses sample data; actual values depend on the site’s metadata.

## Saving your changes

Click **Save Changes** after editing a template. Your changes apply to new tasks; queued tasks, Retry, and Restart keep their recorded requested paths. Chrome's save dialog or the existing-file setting can still affect the final filename.

Tako replaces invalid filename characters with underscores. Unknown macros, empty templates and unusable paths show an error.
