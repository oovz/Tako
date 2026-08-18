<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫画ダウンローダー

**Chrome のサイドパネルから漫画の章を一括ダウンロード。キュー、リトライ、CBZ や ZIP への書き出し — 読書タブから離れずに。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[はじめに](#はじめに) · [機能](#機能) · [対応サイト](#対応サイト) · [Wiki](https://github.com/oovz/Tako/wiki) · [プライバシー](#プライバシー)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 機能

- **サイドパネルコマンドセンター** — 章選択、キュー状況、ダウンロード進行状況を Chrome のサイドパネルから直接操作。読書中のタブのすぐ隣で動作し、詳細な履歴や設定はオプションページで管理できます。
- **安心のキューと自動リトライ** — 多数の章をまとめてキューに追加可能。画像ごとの進捗を確認でき、失敗したダウンロードも自動または手動で再試行。ブラウザの動作も安定して保ちます。
- **クリーンで柔軟な書き出し** — CBZ や ZIP アーカイブ、または画像フォルダとして保存可能。Chrome のダウンロードフォルダへの直接保存に加え、File System Access API を使ってローカルの漫画ライブラリフォルダへ直接書き込むこともできます。
- **ComicInfo.xml メタデータ** — CBZ アーカイブにシリーズ情報、章番号、タイトルなどのメタデータを自動で埋め込み。Komga、Kavita、各種漫画リーダーとスムーズに連携できます。
- **自由なパス・ファイル名テンプレート** — `<SERIES_TITLE>`、`<CHAPTER_NUMBER>`、`<VOLUME_NUMBER>` などのマクロを使って、コレクションを好みのフォルダ構成に自動整理できます。
- **最適化されたサイト統合** — 各対応サイトのページ構造、画像配信、メタデータに合わせた専用アダプターを用意し、高速かつ正確に処理します。
- **統一された設定画面** — 出力形式、パステンプレート、並行数、レート制限のグローバル初期値とサイト別オーバーライドを一元管理できます。
- **プライバシー最優先** — 開発者による分析、トラッキング、テレメトリは一切ありません。設定、キュー、履歴はすべてローカルブラウザ内に保存されます。

## 対応サイト

| サイト                                              | 状態 |
| --------------------------------------------------- | :--: |
| [MangaDex](https://mangadex.org)*                   |  ✅  |
| [Pixiv Comic](https://comic.pixiv.net)              |  ✅  |
| [Shonen Jump+](https://shonenjumpplus.com)          |  ✅  |
| [Manhuagui](https://www.manhuagui.com)              |  ✅  |
| [Comic Nettai](https://www.comicnettai.com)         |  ✅  |
| [MangaMillion](https://mangamillion.shueisha.co.jp) |  ✅  |

- 初期状態では無効。オプション画面で有効化時に任意の HTTPS 権限を要求します。
  新しいサイトの対応をご希望ですか？[機能リクエストを送信](https://github.com/oovz/Tako/issues/new?template=feature_request.md)するか、統合機能の開発にご参加ください — 詳細は[サイト統合ガイド](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)をご覧ください。

## 権利とサイトアクセス

Tako は、お使いのブラウザセッションで既にアクセス可能な対応サイトのページでのみ動作します。

- ペイウォール、ログイン制限、DRM、著作権保護を回避するためのツールでは**ありません**。
- 本来アクセス権のないコンテンツへのアクセス権を付与することは**ありません**。

## はじめに

1. [Chrome ウェブストア](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) からインストールします。
2. 対応している漫画のシリーズまたはエピソードページを開きます。
3. Tako アイコンをクリックしてサイドパネルを開きます。
4. ダウンロードしたい章を選択し、**ダウンロード** をクリックします。

詳しい使い方は[クイックスタートガイド](https://github.com/oovz/Tako/wiki/Quick-Start)をご覧ください。

<details>
<summary><b>ソースコードからインストール</b></summary>

### GitHub Releases から

1. リポジトリの **Releases** ページから最新の `tako-manga-downloader-vX.Y.Z-chrome.zip` をダウンロードします。
2. zip ファイルをローカルフォルダに展開します。
3. Chrome で `chrome://extensions` を開きます。
4. 右上の **デベロッパーモード** を有効にします。
5. **パッケージ化されていない拡張機能を読み込む** をクリックし、展開したフォルダを選択します。

### ローカルビルド

Tako は Chrome 150 以降を対象としています。ローカルビルドには Node.js 20.19+（または Node.js 22.12+）および pnpm 10.32.1 が必要です。

```powershell
pnpm install
pnpm build
```

その後、`chrome://extensions` を開き、**デベロッパーモード** を有効にして **パッケージ化されていない拡張機能を読み込む** から `.output\chrome-mv3` を選択します。

</details>

<details>
<summary><b>開発</b></summary>

```powershell
pnpm dev # WXT 開発サーバー（ホットリロード）
pnpm test:unit # ユニットテスト（Vitest）
pnpm test:e2e # E2E テスト（Playwright）
pnpm lint # ESLint およびアーキテクチャチェック
pnpm type-check # TypeScript 厳格チェック
```

開発ワークフロー、コード規約、プルリクエストのガイドラインの詳細は [`CONTRIBUTING.md`](CONTRIBUTING.md) をご覧ください。

</details>

## ドキュメント

| Wiki ページ                                                                  | 説明                                                   |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| [クイックスタート](https://github.com/oovz/Tako/wiki/Quick-Start)            | インストールと初回ダウンロードのガイド                 |
| [対応サイト](https://github.com/oovz/Tako/wiki/Supported-Sites)              | 現在のサイト統合と対応状況                             |
| [比較](https://github.com/oovz/Tako/wiki/Comparisons)                        | Tako と他のダウンローダーの比較                        |
| [テンプレートマクロ](https://github.com/oovz/Tako/wiki/Template-Macros)      | パスおよびファイル名テンプレートのマクロリファレンス   |
| [アーキテクチャ](https://github.com/oovz/Tako/wiki/Architecture)             | コアランタイム、ストレージ、メッセージング、状態フロー |
| [権限](https://github.com/oovz/Tako/wiki/Permissions)                        | 拡張機能が要求する各権限の説明                         |
| [サイト統合ガイド](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | サイト統合機能の追加と保守                             |

## プライバシー

Tako は設定、キューの状態、ダウンロード履歴をすべてローカルブラウザ内に保存します。ネットワークリクエストは対応サイトおよびダウンロードに必要なインフラに対して直接送信され、開発者が運用する分析・テレメトリサービスはありません。MangaDex を有効にした場合、必要な MangaDex@Home 報告は MangaDex に直接送信されます。

完全なプライバシーポリシーは [`PRIVACY.md`](PRIVACY.md) をご覧ください。

## 貢献

コミュニティからの貢献を歓迎します！プルリクエストを送信する前に[`コントリビューションガイド`](CONTRIBUTING.md)をお読みください。

## ライセンス

MIT — 詳細は [`LICENSE`](LICENSE) をご覧ください。
