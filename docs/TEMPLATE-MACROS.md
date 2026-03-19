# Download Path Template Macros

This document describes all available macros for customizing download paths and filenames in Tako Manga Downloader.

## Overview

Macros are placeholders in your download path template that get replaced with actual values when downloading. They are written in angle brackets like `<SERIES_TITLE>`.

**Example Template**:
```
<INTEGRATION_NAME>/<SERIES_TITLE>/<SERIES_TITLE> - Chapter <CHAPTER_NUMBER_PAD3>
```

**Result**:
```
mangadex/Hunter x Hunter/Hunter x Hunter - Chapter 001.cbz
```

## Macro Reference

### Date Macros

These macros are **always available** and use the current date at download time.

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<YYYY>` | Current year (4 digits) | `2026` | ✅ Yes |
| `<MM>` | Current month (2 digits, zero-padded) | `01` |  ✅ Yes |
| `<DD>` | Current day (2 digits, zero-padded) | `27` | ✅ Yes |

### Site Macros

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<INTEGRATION_NAME>` | Site integration identifier | `mangadex` | ✅ Yes |
| `<PUBLISHER>` | Publisher name (if available) | `Weekly Shonen Jump` | ⚠️ No |

### Series Macros

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<SERIES_TITLE>` | Series/manga title | `Hunter x Hunter` | ✅ Yes* |

*Falls back to "Unknown Series" if not available.

### Chapter Macros

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<CHAPTER_TITLE>` | Chapter title | `Departure` | ⚠️ No |
| `<CHAPTER_NUMBER>` | Raw chapter number | `15.5` | ⚠️ No |
| `<CHAPTER_NUMBER_PAD2>` | Chapter number, 2-digit padded | `01` | ⚠️ No |
| `<CHAPTER_NUMBER_PAD3>` | Chapter number, 3-digit padded | `001` | ⚠️ No |
| `<CHAPTER_INDEX>` | 1-indexed position in download queue | `1` | ✅ Yes |
| `<CHAPTER_INDEX_PAD2>` | Position, 2-digit padded | `01` | ✅ Yes |
| `<CHAPTER_INDEX_PAD3>` | Position, 3-digit padded | `001` | ✅ Yes |

### Volume Macros

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<VOLUME_TITLE>` | Volume title/label | `Volume 1` | ⚠️ No |
| `<VOLUME_NUMBER>` | Raw volume number | `5` | ⚠️ No |
| `<VOLUME_NUMBER_PAD2>` | Volume number, 2-digit padded | `05` | ⚠️ No |

### Language Macro

| Macro | Description | Example | Guaranteed |
|-------|-------------|---------|------------|
| `<LANGUAGE>` | Chapter language (BCP 47 code) | `en` | ⚠️ No |

## Availability Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Yes | Always available - will never be empty |
| ⚠️ No | May be unavailable depending on source site |

## Fallback Behavior

When a macro is not available (marked ⚠️), it is replaced with an **empty string**. This can result in awkward paths if not handled properly.

### Recommended Patterns

**Safe pattern using guaranteed macros**:
```
<INTEGRATION_NAME>/<SERIES_TITLE>/<SERIES_TITLE> - <CHAPTER_INDEX_PAD3>
```

**Pattern with optional chapter number (fallback to index)**:
```
<INTEGRATION_NAME>/<SERIES_TITLE>/Chapter <CHAPTER_NUMBER_PAD3>
```
→ If chapter number unavailable, result may be: `mangadex/Title/Chapter .cbz`

**Better: Use index as guaranteed fallback**:
```
<INTEGRATION_NAME>/<SERIES_TITLE>/<SERIES_TITLE> Ch.<CHAPTER_INDEX_PAD3>
```
→ Always produces: `mangadex/Title/Title Ch.001.cbz`

## Chapter Index vs Chapter Number

| Aspect | `<CHAPTER_NUMBER>` | `<CHAPTER_INDEX>` |
|--------|-------------------|-------------------|
| Source | From manga site | Position in download queue |
| Guaranteed | No | Yes |
| Supports decimals | Yes (e.g., 15.5) | No (always integer) |
| Use case | Preserve original numbering | Consistent file ordering |

**Tip**: Use `<CHAPTER_INDEX_PAD3>` when chapter numbers are unreliable or missing.

## Volume Handling

Not all manga have volume information. When downloading chapters without volumes:

- `<VOLUME_NUMBER>` → empty string
- `<VOLUME_TITLE>` → empty string

**Example handling volumes**:
```
<SERIES_TITLE>/Vol.<VOLUME_NUMBER_PAD2> Ch.<CHAPTER_NUMBER_PAD3>
```

If volume is missing, this produces: `Title/Vol. Ch.001.cbz` (awkward)

**Recommendation**: Only use volume macros if your source consistently provides volume data (check the series page before downloading).

## Examples

### Basic Template
```
<SERIES_TITLE>/<SERIES_TITLE> - Chapter <CHAPTER_INDEX_PAD3>
```
**Result**: `Hunter x Hunter/Hunter x Hunter - Chapter 001.cbz`

### With Site Organization
```
<INTEGRATION_NAME>/<SERIES_TITLE>/<SERIES_TITLE> Ch.<CHAPTER_INDEX_PAD3>
```
**Result**: `mangadex/Hunter x Hunter/Hunter x Hunter Ch.001.cbz`

### Date-Based Organization
```
<YYYY>/<MM>/<SERIES_TITLE> - Ch.<CHAPTER_INDEX_PAD3>
```
**Result**: `2026/01/Hunter x Hunter - Ch.001.cbz`

### Volume + Chapter (when available)
```
<SERIES_TITLE>/Vol.<VOLUME_NUMBER_PAD2>/Ch.<CHAPTER_NUMBER_PAD3> - <CHAPTER_TITLE>
```
**Result**: `Hunter x Hunter/Vol.01/Ch.001 - Departure.cbz`

## Invalid Characters

The following characters are automatically sanitized from macro values to ensure valid filenames:

- `\` `/` `:` `*` `?` `"` `<` `>` `|`

These are replaced with underscores (`_`) or removed.

## Validation

The extension validates your template before saving:
- Unknown macros will show an error
- Empty templates are not allowed
- Templates must produce valid filesystem paths

You can preview the result with sample data in the Settings page.
