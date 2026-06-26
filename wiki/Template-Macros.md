# Template Macros

Macros are placeholders in directory and filename templates, written in angle brackets like `<SERIES_TITLE>`. Tako resolves them at download time to build the output path for each chapter.

## How templates work

Tako resolves two templates per chapter:

- **Directory template** (`pathTemplate`) — resolves to a folder path.
- **Filename template** (`fileNameTemplate`) — resolves to the chapter archive name, or the loose-image chapter folder name when the format is `none`.

Default directory template:

```text
<INTEGRATION_NAME>/<SERIES_TITLE>
```

Result with default filename template and CBZ format:

```text
mangadex/Hunter x Hunter/Departure.cbz
```

## Macro reference

### Date macros

Always available. Use the user's local date at download time.

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<YYYY>` | Current year, 4 digits | `2026` | Yes |
| `<MM>` | Current month, zero-padded | `05` | Yes |
| `<DD>` | Current day, zero-padded | `12` | Yes |

### Site macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<INTEGRATION_NAME>` | Site integration identifier | `mangadex` | Yes |
| `<PUBLISHER>` | Publisher name, if the integration provides it | `Weekly Shonen Jump` | No |

### Series macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<SERIES_TITLE>` | Series or manga title | `Hunter x Hunter` | Yes |

### Chapter macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<CHAPTER_TITLE>` | Chapter title used for the final file or folder name | `Departure` | Yes for queued downloads |
| `<CHAPTER_NUMBER_PAD2>` | Numeric chapter number padded to 2 digits | `01` | No |
| `<CHAPTER_NUMBER_PAD3>` | Numeric chapter number padded to 3 digits | `001` | No |

### Volume macros

| Macro | Description | Example | Guaranteed |
|---|---|---|---|
| `<VOLUME_TITLE>` | Site-visible volume or category label, if available | `单行本` | No |
| `<VOLUME_NUMBER_PAD2>` | Numeric volume number padded to 2 digits | `05` | No |

`<VOLUME_TITLE>` comes from the preserved volume/category label (`Volume.title`, `Volume.label`, or `Chapter.volumeLabel`), not from `volumeId`. The `volumeId` field is an internal grouping key and is not exposed as a template macro. Use `<VOLUME_NUMBER_PAD2>` only when the site integration provides parsed numeric `volumeNumber` metadata.

## Missing values

When an optional macro is unavailable, it resolves to an empty string. Empty directory segments are discarded, but empty pieces inside a filename remain.

Example filename template:

```text
Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>
```

If the site does not provide a numeric chapter number, the filename starts with `Ch. - ...`.

Use numeric macros only for integrations and page types known to provide numeric chapter or volume metadata.

## Recommended patterns

### Default directory

```text
TMD/<SERIES_TITLE>
```

### Default filename

```text
<CHAPTER_TITLE>
```

### Site-grouped directory

```text
<INTEGRATION_NAME>/<SERIES_TITLE>
```

### Date-grouped directory

```text
<YYYY>/<MM>/<SERIES_TITLE>
```

### Numbered filename when chapter numbers are reliable

```text
Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>
```

## Directory vs filename semantics

`pathTemplate` is directory-only. If a directory template contains an extension-like suffix such as `.cbz`, Tako treats it as part of the folder name, not the final archive filename.

Use `fileNameTemplate` for the final chapter name. Tako appends `.cbz` or `.zip` for archive formats. For `none`, the filename template becomes the chapter folder under the resolved directory.

## Invalid characters

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

## Developer notes

`src/shared/template-macros.ts` contains registry metadata used for validation and previews. `src/shared/template-resolver.ts` is the production resolver used during queue dispatch.

Do not document a macro as user-facing until both files support it. The registry currently includes a few compatibility tokens — raw numeric, chapter-index, and language macros — that the production resolver does not populate in final paths.
