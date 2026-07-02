<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫画ダウンローダー

**Chromeのサイドパネルから漫画章を一括ダウンロード。キュー、リトライ、CBZ/ZIP書き出し — 読書タブから離れずに。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[インストール](#はじめに) · [機能](#機能) · [対応サイト](#対応サイト) · [Wiki](https://github.com/oovz/Tako/wiki) · [プライバシー](#プライバシー)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 機能

- **サイドパネルコマンドセンター** — 章選択、キュー、進行状況がすべてChromeのサイドパネルにあります。読書中のタブのすぐ隣。余計なタブも保存ダイアログも不要。
- **本物のキューとリトライ** — 数十の章をキューに追加し、画像ごとの進行状況を確認し、失敗したダウンロードを自動または手動で再試行。同時に処理するタスクは1つだけなので安定動作。
- **クリーンな書き出し** — CBZ、ZIP、または画像フォルダで保存。カスタムパスとファイル名テンプレートはKomga、Kavita、Calibreなどのライブラリツールに対応。
- **最適化されたサイト統合** — 対応サイトごとに専用のページ構造、画像CDN、メタデータ処理を提供 — 汎用スクレイピングではありません。
- **統一設定ページ** — 出力形式、テンプレート、レート制限、リトライのグローバルデフォルトとサイト別オーバーライドがすべてオプションページに集約。
- **File System Access対応** — カスタムダウンロードフォルダを選択すると、Takoが直接書き込みます。必要に応じてChromeのダウンロードバーにフォールバック。
- **ComicInfo.xml生成** — CBZアーカイブにシリーズメタデータ、章番号、作者などを埋め込み、コミックライブラリマネージャーとの互換性を確保。
- **プライバシー優先** — 分析なし、テレメトリなし、データ収集なし。すべてローカルブラウザ内に留まります。

## 対応サイト

| サイト | 状態 |
|---|:---:|
| [MangaDex](https://mangadex.org) | ✅ |
| [Pixiv Comic](https://comic.pixiv.net) | ✅ |
| [Shonen Jump+](https://shonenjumpplus.com) | ✅ |
| [Manhuagui](https://www.manhuagui.com) | ✅ |
| [Comic Nettai](https://comic-nettai.com) | ✅ |

新しいサイトを希望しますか？[リクエストを送信](https://github.com/oovz/Tako/issues/new?template=feature_request.md)するか、統合を貢献してください — [サイト統合ガイド](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)を参照。

## 権利とサイトアクセス

Takoは、お使いのブラウザセッションで既にアクセス可能な対応サイトのページのみを対象としています。

- ペイウォール、ログイン制限、DRM、著作権管理をバイパスするツールでは**ありません**。
- お持ちでないアクセス権を付与することは**ありません**。

## はじめに

1. [Chrome ウェブストア](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)からインストール。
2. 対応している漫画シリーズページを開く。
3. Takoアイコンをクリックしてサイドパネルを開く。
4. 章を選択し、**ダウンロード**をクリックしてキューを確認。

詳細な手順は[クイックスタートWikiページ](https://github.com/oovz/Tako/wiki/Quick-Start)を参照してください。

<details>
<summary><b>ソースからインストール</b></summary>

### GitHub Releasesから

1. リポジトリの **Releases** ページに移動し、最新の `tako-manga-downloader-vX.Y.Z-chrome.zip` をダウンロード。
2. zipをフォルダに展開。
3. `chrome://extensions` を開く。
4. **デベロッパーモード**を有効化。
5. **パッケージ化されていない拡張機能を読み込む**を選択し、展開したフォルダを選択。

### ローカルビルド

```powershell
pnpm install
pnpm build
```

`chrome://extensions` を開き、**デベロッパーモード**を有効化し、**パッケージ化されていない拡張機能を読み込む**を選択して `.output\chrome-mv3` を選択。

</details>

<details>
<summary><b>開発</b></summary>

```powershell
pnpm dev          # WXT 開発サーバー（ホットリロード）
pnpm test:unit    # ユニットテスト（Vitest）
pnpm test:e2e     # E2Eテスト（Playwright、モックルート）
pnpm lint         # ESLint
pnpm type-check   # TypeScript 厳格モード
```

開発ワークフロー、コードスタイルルール、PRガイドラインの詳細は [`CONTRIBUTING.md`](CONTRIBUTING.md) を参照。

</details>

## ドキュメント

| Wikiページ | 説明 |
|---|---|
| [クイックスタート](https://github.com/oovz/Tako/wiki/Quick-Start) | インストールと初回ダウンロードのガイド |
| [対応サイト](https://github.com/oovz/Tako/wiki/Supported-Sites) | 現在のサイト統合と状態 |
| [比較](https://github.com/oovz/Tako/wiki/Comparisons) | Takoと他の漫画ダウンローダーの比較 |
| [テンプレートマクロ](https://github.com/oovz/Tako/wiki/Template-Macros) | ファイル名とパステンプレートのマクロリファレンス |
| [アーキテクチャ](https://github.com/oovz/Tako/wiki/Architecture) | コアランタイム、ストレージ、メッセージング、状態フロー |
| [権限](https://github.com/oovz/Tako/wiki/Permissions) | 各要求権限の用途 |
| [サイト統合ガイド](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | サイト統合の追加または保守 |

## プライバシー

Takoは設定、キュー状態、履歴をローカルブラウザに保存します。ネットワークリクエストは対応サイトとダウンロードに必要な関連インフラに直接送信されます。分析バックエンドなし、テレメトリなし、データ収集なし。

完全なプライバシーポリシーは [`PRIVACY.md`](PRIVACY.md) を参照。

## 貢献

貢献を歓迎します。Pull Requestを提出する前に[`貢献ガイドライン`](CONTRIBUTING.md)をお読みください。

## ライセンス

MIT — 詳細は [`LICENSE`](LICENSE) を参照。
