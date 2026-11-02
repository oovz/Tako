# アーキテクチャ

[English](Architecture) · [日本語](Architecture.ja) · [简体中文](Architecture.zh-CN) · [繁體中文](Architecture.zh-TW) · [한국어](Architecture.ko)

このページは[英語版](Architecture)から機械翻訳されています。

Tako は WXT で開発した Manifest V3 拡張機能で、Chrome 150 以降に対応しています。このページでは、作業に応じたソースコードの場所を紹介します。ダウンロードについては[クイックスタート](Quick-Start.ja)と[トラブルシューティング](Troubleshooting.ja)をご覧ください。

## 拡張機能の構成

| 構成要素                           | 役割                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| サイドパネルとオプション           | 話の選択、ダウンロードの進捗、履歴、設定                       |
| バックグラウンドのサービスワーカー | キュー、保存された状態、権限、Chrome のダウンロードの管理      |
| オフスクリーンドキュメント         | 話の画像の取得・処理、アーカイブ作成、カスタムフォルダへの保存 |
| サイト統合機能                     | サイトの識別、作品情報、話一覧、画像の取り扱い                 |

## ソースの案内

| 作業対象                   | 参照先                                                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| サイドパネルとオプション   | [`entrypoints/sidepanel/`](https://github.com/oovz/Tako/tree/main/entrypoints/sidepanel), [`entrypoints/options/`](https://github.com/oovz/Tako/tree/main/entrypoints/options) |
| バックグラウンドのタスク   | [`entrypoints/background/`](https://github.com/oovz/Tako/tree/main/entrypoints/background)                                                                                     |
| 画像処理とアーカイブ作成   | [`entrypoints/offscreen/`](https://github.com/oovz/Tako/tree/main/entrypoints/offscreen)                                                                                       |
| サイト対応                 | [`src/site-integrations/`](https://github.com/oovz/Tako/tree/main/src/site-integrations)                                                                                       |
| ドメインロジック           | [`src/domain/`](https://github.com/oovz/Tako/tree/main/src/domain)                                                                                                             |
| 設定と履歴の保存           | [`src/storage/`](https://github.com/oovz/Tako/tree/main/src/storage)                                                                                                           |
| 共通のランタイム機能       | [`src/runtime/`](https://github.com/oovz/Tako/tree/main/src/runtime)                                                                                                           |
| 統合機能のインターフェース | [`src/types/site-integrations.ts`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)                                                                      |

環境の準備やテストの手順は[開発者向けガイド](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)に、サイトの追加方法は[サイト統合ガイド](Site-Integration-Guide.ja)にまとめています。

## 参考資料

- [Chrome 拡張機能の Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome サイドパネル API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome オフスクリーン API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome ダウンロード API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
