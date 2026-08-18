# MangaMillion

MangaMillion (`https://mangamillion.shueisha.co.jp/`) is an official manga translation platform by Shueisha.

## Approach

MangaMillion uses an official Protocol Buffer API (`https://api.mangamillion.shueisha.co.jp/api/*`) requiring a client device access token obtained via anonymous registration (`/api/register`).

- **Background resolver**: Resolves series metadata from `/api/title_detail` and chapter catalog from `/api/chapter_list`.
- **Offscreen resolver**: Resolves chapter image URLs and decryption parameters from `/api/viewer`.
- **Decryption**: Page images are served encrypted with AES-256-CBC and decrypted using standard Web Crypto API (`crypto.subtle`) in the offscreen document.

## Endpoints

- `mangamillion-api`: Official Protobuf API on `https://api.mangamillion.shueisha.co.jp/*`.
- `mangamillion-image`: Encrypted manga page image CDN on `https://img.mangamillion.shueisha.co.jp/*`.

## States covered

- Free available chapters (`groupType: 0`, `translatedChapterId > 0`).
- Unavailable/locked chapters (`groupType: 1` or `groupType: 3` for untranslated languages, or `translatedChapterId === 0`).
- Multi-language titles (English `en`, Japanese `ja`, etc.).
- Image decryption with AES-256-CBC and AVIF/WebP image format detection.

## Live smoke

Sample series URL:

- `https://mangamillion.shueisha.co.jp/en/title/1` (One Piece)

Sample chapter URL:

- `https://mangamillion.shueisha.co.jp/en/title/1/chapter/6736` (#001)
