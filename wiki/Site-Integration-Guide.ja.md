# サイト統合を追加する

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

コードを書かずに対応サイトをリクエストする場合は、[機能リクエスト](https://github.com/oovz/Tako/issues/new?template=feature_request.md)を作成してください。開発環境の準備は[貢献ガイド（英語）](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)を参照してください。

## 統合を作成する

```sh
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

`--name` にはサイトの現地語名を指定します。英語のサイトでは `--english-name` にも同じ名前を指定します。それ以外のサイトでは、公式サイト、ロゴ、公式 SNS アカウントで運営元が使用している英語名またはラテン文字のブランド名を指定します。どちらもない場合は、メインドメインのパブリックサフィックス直前の部分を使います。たとえば `www.example.co.jp` なら `example` を指定します。

ソースファイルは `src/site-integrations/<id>/`、テストデータは `tests/fixtures/site-integrations/<id>/` に作成されます。

`definition.json` に対応 URL と必要なアクセス権限を定義します。作品情報とエピソード一覧の取得は `background-runtime.ts`、エピソード画像の取得は `offscreen-runtime.ts` に実装します。[定義スキーマ](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)、[実行時インターフェース](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)、構成が近い既存の統合機能を参考にしてください。

リクエストには `integrationHttpClient`、画像には `fetchImageWithStallDetection` を使ってください。キャンセル、レート設定、バイト単位の進捗、リソース管理に関する引数を引き継いでください。各リクエストは一度だけスケジュールします。

リソースの確保や権限を伴う操作の前に、応答サイズ、画像の寸法、ページ数、サイトが発行した URL を検証してください。画像変換に必要なリソースを予約し、成功・失敗・キャンセルのいずれの場合も解放します。

サイトへのアクセス権限は、必要なものだけを要求してください。実行コードは拡張機能に同梱し、サイトの応答に含まれるコードを実行したり、認証情報をログに残したりしないでください。

## テストを追加する

HTML、API、画像のテストデータは、生成された `contract.json` と同じフォルダに置きます。出典を記録し、アカウント情報、Cookie、トークンを取り除いてください。

生成ツールは `contract.json` の形式を検証します。`schemaVersion: 1`、統合に対応する `providerId`、オブジェクト型の `data` が必要です。

メタデータ、エピソード順、画像変換、失敗時の処理をテストします。画面の動作にはモックを使ったブラウザテストを追加し、アーカイブの有無だけでなく保存された画像も確認してください。サイトにアクセスできる場合はライブテストも追加します。

```sh
pnpm generate:site-integrations
pnpm lint
pnpm type-check
pnpm test:unit
```

[貢献ガイドのテスト手順](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)に沿って必要な結合・ブラウザテストを実行し、最後に `pnpm build` を実行してください。

## 仕上げる

ひな形の生成直後は `shipped: false`、`enabledByDefault: false` です。実装とテストが整ってから `shipped: true` に変更し、カタログを再生成してください。

型付きの設定を `customSettings` に定義します。各設定で参照するラベル、説明、選択肢のラベルを、`en`、`ja`、`zh_CN`、`zh_TW`、`ko` の 5 言語すべてのカタログに追加してください。

[対応サイト](Supported-Sites.ja)と[トラブルシューティング](Troubleshooting.ja)を更新し、ダウンロードに影響するアクセス条件も記載してください。

## 任意の機能

### ワンショットのページプローブ

ページの現在の状態が必要な場合は、`pageProbe: "optional"` または `"required"` を宣言し、`probe.ts` を用意してください。プローブは読み取り専用で、読み取る範囲を限定してください。返す値は検証済みのプレーンデータとし、完了後はリソースを解放します。既定では分離ワールドを使ってください。

### リクエストヘッダー

必要な Referer ルールを `sessionRefererRules` に定義してください。ID は管理対象の範囲 `41000`–`41999` に収め、宣言済みのサイトのドメイン・オリジンを使ってください。ルールの適用範囲は拡張機能のリクエストに限定してください。

### 画像変換

画像変換を定義ファイルに宣言し、オフスクリーンドキュメントで実装してください。コマ、タイル、ページの順序をテストします。表紙に異なる画像処理が必要な場合は、`cover.downloadImage` を実装してください。

### サイトが指定する画像サーバー

画像ホストが動的に選ばれる場合は、`originKind: "provider-issued"` を宣言し、サイトから URL を受け取る箇所で検証してください。固定のエンドポイントのオリジンは `requiredOrigins`、任意のホストパターンは `optionalOrigins` に記述します。
