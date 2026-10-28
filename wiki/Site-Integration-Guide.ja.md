# サイト統合機能の開発

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

このページは[英語版](Site-Integration-Guide)から機械翻訳されています。

このガイドは、対応サイトの追加や保守を行う開発者向けです。コードを書かずにサイトの追加を依頼する場合は、[機能リクエスト](https://github.com/oovz/Tako/issues/new?template=feature_request.md)を作成してください。

環境の準備は[開発者向けガイド](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)、ランタイムの役割分担は[アーキテクチャ](Architecture.ja)をご覧ください。統合機能は、拡張機能に同梱される TypeScript モジュールです。

## 統合機能の役割

サイト統合機能は、対応するページを識別し、作品や話の情報を解決し、画像のダウンロードとサイト固有の画像変換を行います。定義ファイルには、オリジン、リクエストポリシー、設定を宣言します。

## サイトを追加する

### 1. ひな形を作る

```powershell
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

このコマンドは、ソースファイルとテストデータのひな形を作成します。

| ファイル                                              | 用途                                                 |
| ----------------------------------------------------- | ---------------------------------------------------- |
| `src/site-integrations/<id>/definition.json`          | 識別情報、URL の照合、オリジン、機能、ポリシー、設定 |
| `src/site-integrations/<id>/background-runtime.ts`    | 作品と話一覧の解決                                   |
| `src/site-integrations/<id>/offscreen-runtime.ts`     | チャプタープランと画像のダウンロード                 |
| `src/site-integrations/<id>/contracts/index.ts`       | サイトのデータ契約                                   |
| `tests/fixtures/site-integrations/<id>/contract.json` | 決定的なテストデータのひな形                         |

ひな形は `shipped: false` と `enabledByDefault: false` で作成されます。実装とテストがリリース可能になったら、`shipped: true` にします。独立した場所に作成する場合は、`--out-dir` でソースの出力先、`--fixtures-dir` でテストデータの出力先を指定します。

### 2. サイトの契約を宣言する

[定義スキーマ](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)と、似た既存の統合機能を参考に、`definition.json` を編集します。

`name` にはサイトの原語での表示名、`englishName` には英語名を設定します。`id` と統合ディレクトリには安定した識別子を使い、代替ドメインは照合ルールに記載します。

Tako が認識するページ、固定・追加のオリジン、エンドポイントの用途、認証情報、応答の型と上限、リクエスト間隔、再試行の担当、必要なランタイム機能を定義します。統合機能に必要なアクセスを宣言してください。

### 3. バックグラウンドで作品情報を解決する

[`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)に従い、`background-runtime.ts` に `series.resolveSeriesData` を実装します。

URL のデータ、サイトの API、取得した HTML から、作品タイトル、メタデータ、話 ID、話の URL、利用可否を解決します。リクエストには `integrationHttpClient` を使い、サイトのデータを検証してから返してください。話の処理に必要な場合に限り、ディスパッチコンテキストの準備を追加します。

### 4. オフスクリーンで話の画像を解決・ダウンロードする

[`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)に従い、`offscreen-runtime.ts` に `chapter.resolveChapterPlan` と `chapter.downloadImage` を実装します。

共有のチャプタープランスキーマと `fetchImageWithStallDetection` を使用します。キャンセル、レート設定、バイト進捗、リソース管理を引き継ぎ、インターフェースで定義された画像結果を返してください。各リクエストを一度だけスケジュールします。

メモリの確保や権限を必要とする操作の前に、応答サイズ、画像サイズ、ページ数、サイトが発行する URL を検証します。変換処理では必要なリソースを予約し、成功・失敗・キャンセルのいずれの場合も解放してください。

### 5. 文書とテストを用意する

保存した HTML、プロトコルのテストベクトル、制御された画像入力は `tests/fixtures/site-integrations/<id>/` に置きます。ジェネレーターは、標準の `contract.json` にある `schemaVersion: 1`、統合機能の `providerId`、オブジェクト型の `data` を確認します。取得した値と合成したテストデータを区別できるように、出典の説明をデータの隣に置いてください。

対象を絞った単体テストを追加し、UI に現れる動作はモックを使ったブラウザテストでも確認します。デコードの成功に加え、ページ順序や変換後の画像内容を確認してください。

利用者向けの説明は[対応サイト](Supported-Sites.ja)と[トラブルシューティング](Troubleshooting.ja)で更新します。実サイトの検証は `tests/live/` に置き、共有する作品 URL は `tests/e2e/fixtures/test-domains-constants.ts` で定義します。

### 6. 生成と検証を行う

開発中は、対象を絞ったテストと以下のチェックを実行します。

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
pnpm type-check
pnpm lint
pnpm test:unit
```

リゾルバーとフィクスチャが準備できたら、`shipped: true` にしてカタログを再生成します。[開発者向けガイド](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)に従って必要な統合・ブラウザ検証を実行し、`pnpm build` で製品版の拡張機能をビルドします。

サイトを利用できる場合は、[実際の話の検証](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation)を実行し、変換後のページをサイトのリーダーと比較してください。

## 追加の機能

### 一回限りのページプローブ

実ページの状態が必要な場合は、`pageProbe: "optional"` または `"required"` を宣言し、`probe.ts` を用意します。読み取り範囲を制限したプローブで、検証済みのプレーンデータを返し、終了時にリソースを解放してください。通常は分離ワールドを使用します。

### リクエストヘッダー

必要な Referer ルールを `sessionRefererRules` に宣言します。管理対象の ID 範囲 `41000`–`41999` と、宣言済みのサイトのドメイン・オリジンを使用します。ルールは拡張機能からのリクエストを対象にします。

### 画像変換

画像変換を定義ファイルに宣言し、オフスクリーン側に実装します。コマ、タイル、ページの順序をテストしてください。表紙に別の画像処理が必要な場合は `cover.downloadImage` を実装します。

### サイトが発行する画像サーバー

動的に選ばれる画像ホストには、`originKind: "provider-issued"` を宣言し、サイトから URL を受け取る箇所で検証します。固定のエンドポイントオリジンは `requiredOrigins`、追加のホストパターンは `optionalOrigins` に置きます。

### 設定の多言語化

`customSettings` に型付きの設定を宣言します。ラベル、説明、選択肢のラベルを、五つの言語カタログ `en`、`ja`、`zh_CN`、`zh_TW`、`ko` すべてに用意してください。必要なキーがあるかをジェネレーターが確認します。

## 共通のリクエスト保護

リクエストには `integrationHttpClient` と共有の画像転送を使用します。必要なオリジン、認証情報の扱い、応答の上限を定義ファイルに宣言してください。実行するコードは拡張機能に同梱し、リモート応答はデータとして解析します。認証情報と生の応答はログに含めないでください。

関連ページ：[アーキテクチャ](Architecture.ja)、[権限](Permissions.ja)、[対応サイト](Supported-Sites.ja)。
