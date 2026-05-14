# Download Path Template Macros

This document describes the production-supported macros for customizing download folders and chapter filenames in Tako.

## Overview

Macros are placeholders in directory and filename templates. They are written in angle brackets like `<SERIES_TITLE>`.

Tako resolves two templates for each chapter:

- **Directory template** (`pathTemplate`) resolves to a folder path.
- **Filename template** (`fileNameTemplate`) resolves to the chapter archive name, or the loose-image chapter folder name when the format is `none`.

**Directory template**:

```text
<INTEGRATION_NAME>/<SERIES_TITLE>
```

**Result with default filename template and CBZ format**:

```text
mangadex/Hunter x Hunter/Departure.cbz
```

## Macro Reference

### Date Macros

These macros are always available and use the user's local date at download time.

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<YYYY>` | Current year, 4 digits | `2026` | Yes |
| `<MM>` | Current month, zero-padded | `05` | Yes |
| `<DD>` | Current day, zero-padded | `12` | Yes |

### Site Macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<INTEGRATION_NAME>` | Site integration identifier | `mangadex` | Yes |
| `<PUBLISHER>` | Publisher name, if the integration provides it | `Weekly Shonen Jump` | No |

### Series Macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<SERIES_TITLE>` | Series or manga title | `Hunter x Hunter` | Yes |

### Chapter Macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<CHAPTER_TITLE>` | Chapter title used for the final file or folder name | `Departure` | Yes for queued downloads |
| `<CHAPTER_NUMBER_PAD2>` | Numeric chapter number padded to 2 digits | `01` | No |
| `<CHAPTER_NUMBER_PAD3>` | Numeric chapter number padded to 3 digits | `001` | No |

### Volume Macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<VOLUME_TITLE>` | Volume label/title, if available | `Volume 1` | No |
| `<VOLUME_NUMBER_PAD2>` | Numeric volume number padded to 2 digits | `05` | No |

## Missing Values

When an optional macro is not available, it resolves to an empty string. Empty directory segments are discarded, but empty pieces inside a filename remain.

Example filename template:

```text
Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>
```

If the site does not provide a numeric chapter number, the filename can start with `Ch. - ...`.

Use numeric macros only for integrations and page types that are known to provide numeric chapter or volume metadata.

## Recommended Patterns

### Default Directory

```text
TMD/<SERIES_TITLE>
```

### Default Filename

```text
<CHAPTER_TITLE>
```

### Site-Grouped Directory

```text
<INTEGRATION_NAME>/<SERIES_TITLE>
```

### Date-Grouped Directory

```text
<YYYY>/<MM>/<SERIES_TITLE>
```

### Numbered Filename When Chapter Numbers Are Reliable

```text
Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>
```

## Directory vs Filename Semantics

`pathTemplate` is directory-only. If a directory template contains an extension-like suffix such as `.cbz`, Tako treats that suffix as part of the folder name rather than as the final archive filename.

Use `fileNameTemplate` for the final chapter name. Tako appends `.cbz` or `.zip` for archive formats. For `none`, Tako uses the filename template as the chapter folder under the resolved directory.

## Invalid Characters

Tako sanitizes path components for cross-platform filesystem compatibility. The following characters are replaced with underscores:

```text
< > : " / \ | ? *
```

Control characters, Windows reserved names, and trailing Windows-incompatible dots or spaces are also sanitized.

## Validation

The extension validates templates before saving:

- Unknown macros produce an error.
- Empty templates are not allowed.
- Resolved paths must be valid relative filesystem paths.

The Options page preview uses sample data to show the resolved directory and filename.

## Developer Notes

`src/shared/template-macros.ts` contains registry metadata used for validation and previews. `src/shared/template-resolver.ts` is the production resolver used during queue dispatch.

Do not document a macro as user-facing until both files support it. Registry metadata currently includes a few compatibility tokens, including raw numeric, chapter-index, and language macros, that the production resolver does not populate in final paths.
