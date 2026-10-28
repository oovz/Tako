# 貢獻網站整合

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

> 本頁由[英文原文](Site-Integration-Guide)機器翻譯而成。

本指南供新增或維護支援網站的貢獻者參閱。若只想建議支援網站，可直接[提交功能要求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。

開發環境設定請閱讀[貢獻指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)，執行階段所有權請閱讀[架構](Architecture.zh-TW)。整合是隨擴充功能封裝的 TypeScript 模組。

## 整合負責的內容

網站整合負責識別支援頁面、解析作品與章節資料、下載圖片，以及處理網站特有的圖片轉換。其定義會宣告來源、請求原則與設定。

## 新增網站

### 1. 建立骨架

```powershell
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

此命令會建立原始碼檔案與測試資料種子：

| 檔案                                                  | 用途                                       |
| ----------------------------------------------------- | ------------------------------------------ |
| `src/site-integrations/<id>/definition.json`          | 識別資料、網址比對、來源、能力、原則與設定 |
| `src/site-integrations/<id>/background-runtime.ts`    | 作品與章節清單解析                         |
| `src/site-integrations/<id>/offscreen-runtime.ts`     | 章節計畫與圖片下載                         |
| `src/site-integrations/<id>/contracts/index.ts`       | 網站資料契約                               |
| `tests/fixtures/site-integrations/<id>/contract.json` | 確定性測試資料種子                         |

骨架初始設定為 `shipped: false` 與 `enabledByDefault: false`。實作與測試可供發行時，再設為 `shipped: true`。若要在獨立位置建立骨架，可用 `--out-dir` 指定原始碼目錄，並以 `--fixtures-dir` 指定測試資料目錄。

### 2. 宣告網站契約

編輯 `definition.json`，以[定義結構描述](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)和類似的現有整合作為參考。

填寫網站原文名稱 `name` 與英文名稱 `englishName`。`id` 與整合目錄使用穩定的識別碼；替代網域則在比對規則中宣告。

定義 Tako 應識別的頁面、固定與選用來源、端點用途、憑證、回應類型與限制、請求間隔、重試所有權及所需執行階段能力。只宣告整合需要的存取範圍。

### 3. 在背景解析作品

依照 [`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)，在 `background-runtime.ts` 實作 `series.resolveSeriesData`。

從網址資料、網站 API 或擷取的 HTML 解析作品標題、中繼資料、章節 ID、章節網址與可用狀態。請求使用 `integrationHttpClient`，回傳前先驗證網站資料。僅在章節處理需要時，加入分派情境準備作業。

### 4. 在離屏文件解析與下載章節圖片

依照 [`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)，在 `offscreen-runtime.ts` 實作 `chapter.resolveChapterPlan` 與 `chapter.downloadImage`。

使用共用章節計畫結構描述與 `fetchImageWithStallDetection`。傳遞取消訊號、速率設定、位元組進度與資源管理參數，回傳介面定義的圖片結果。每個請求只排程一次。

在配置資源或進行特殊權限操作前，先驗證回應大小、圖片尺寸、頁數及網站提供的網址。轉換作業必須預留所需資源，並在成功、失敗或取消時釋放。

### 5. 撰寫整合文件與測試

將擷取的 HTML、通訊協定測試向量與受控圖片輸入放在 `tests/fixtures/site-integrations/<id>/`。產生器會檢查標準 `contract.json` 的封裝格式：`schemaVersion: 1`、整合對應的 `providerId`，以及物件型別的 `data`。在資料旁保留來源說明，讓貢獻者區分擷取欄位與合成測試資料。

加入針對性的單元測試，並對介面可見的行為加入模擬瀏覽器測試。除了確認可解碼，也要檢查頁面順序與轉換後的圖片內容。

在[支援網站](Supported-Sites.zh-TW)與[疑難排解](Troubleshooting.zh-TW)更新讀者說明。實際網站檢查放在 `tests/live/`，共用作品網址定義在 `tests/e2e/fixtures/test-domains-constants.ts`。

### 6. 產生與驗證

開發期間，執行針對性測試與下列檢查：

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
pnpm type-check
pnpm lint
pnpm test:unit
```

解析器與測試資料準備完成後，設為 `shipped: true` 並重新產生目錄資料。執行[貢獻指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)中適用的整合與瀏覽器檢查，再以 `pnpm build` 建置正式版擴充功能。

網站可存取時，執行[實際章節檢查](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation)，並將轉換後的頁面與網站閱讀器比對。

## 選用能力

### 單次頁面探測

需要即時頁面狀態時，宣告 `pageProbe: "optional"` 或 `"required"`，並提供 `probe.ts`。使用有界的唯讀探測，回傳通過驗證的純資料，完成後釋放資源。預設使用隔離執行環境。

### 請求標頭

在 `sessionRefererRules` 宣告所需的來源頁面規則。使用受管理的 ID 範圍 `41000`–`41999`，以及已宣告的網站網域與來源。規則只套用至擴充功能請求。

### 圖片轉換

在定義檔中宣告圖片轉換，並在離屏執行階段實作。測試分格、圖塊與頁面順序。封面需要不同的圖片處理時，實作 `cover.downloadImage`。

### 網站提供的圖片伺服器

對動態選擇的圖片主機，宣告 `originKind: "provider-issued"`，並在網站提供網址的邊界進行驗證。固定端點來源放在 `requiredOrigins`；選用主機模式放在 `optionalOrigins`。

### 本地化設定

在 `customSettings` 宣告具型別的設定。標籤、說明與選項標籤必須存在於全部五種語系目錄：`en`、`ja`、`zh_CN`、`zh_TW` 與 `ko`。產生器會檢查必要索引鍵是否存在。

## 共用請求安全性

請求使用 `integrationHttpClient` 與共用圖片傳輸。在定義檔中宣告所需的來源、憑證原則與回應大小限制。可執行程式碼隨擴充功能封裝，遠端回應作為資料解析。不要在記錄中包含憑證與原始回應。

相關頁面：[架構](Architecture.zh-TW)、[權限說明](Permissions.zh-TW)與[支援網站](Supported-Sites.zh-TW)。
