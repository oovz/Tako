# 新增站點整合

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

不撰寫程式碼也可以[申請支援新網站](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。開發環境的準備步驟請見[貢獻指南（英文）](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)。

## 建立整合

```sh
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

工具會在 `src/site-integrations/<id>/` 建立原始碼，在 `tests/fixtures/site-integrations/<id>/` 建立測試資料。

在 `definition.json` 宣告支援的 URL 和所需存取權限。在 `background-runtime.ts` 實作作品資訊與章節清單的載入，在 `offscreen-runtime.ts` 實作章節圖片的載入。可參考[定義結構](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)、[執行階段介面](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)，以及相似的現有整合。

使用 `integrationHttpClient` 發送請求，使用 `fetchImageWithStallDetection` 取得圖片。傳遞取消訊號、速率設定、位元組進度與資源管理參數。每個請求只排程一次。

在配置資源或進行特殊權限操作前，先驗證回應大小、圖片尺寸、頁數及網站提供的網址。轉換作業必須預留所需資源，並在成功、失敗或取消時釋放。

只申請必要的網站存取權限。可執行程式碼須隨擴充功能打包；不要執行網站回應中的程式碼，也不要將憑證寫入日誌。

## 新增測試

將 HTML、API 與圖片測試資料放在產生的 `contract.json` 旁。註明來源，移除帳戶資訊、Cookie 和權杖。

產生器會檢查 `contract.json` 的外層結構：`schemaVersion: 1`、整合對應的 `providerId`，以及物件型別的 `data`。

測試中繼資料、章節順序、圖片轉換和失敗處理。介面行為使用模擬瀏覽器測試驗證；除了確認壓縮檔存在，還要檢查儲存的圖片。能存取實際網站時，加入實站測試。

```sh
pnpm generate:site-integrations
pnpm lint
pnpm type-check
pnpm test:unit
```

依照[貢獻指南的測試說明](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)執行相關的整合測試與瀏覽器測試，最後執行 `pnpm build`。

## 完成提交

工具預設使用 `shipped: false` 和 `enabledByDefault: false`。實作與測試準備好後，再改為 `shipped: true`，並重新產生整合清單。

在 `customSettings` 宣告具型別的設定。請在全部五種語系目錄中補齊所引用的標籤、說明與選項標籤：`en`、`ja`、`zh_CN`、`zh_TW` 與 `ko`。

更新[支援的網站](Supported-Sites.zh-TW)與[疑難排解](Troubleshooting.zh-TW)，說明會影響下載的存取條件。

## 選用能力

### 單次頁面探測

需要即時頁面狀態時，宣告 `pageProbe: "optional"` 或 `"required"`，並提供 `probe.ts`。使用受限的唯讀探測，回傳通過驗證的純資料，完成後釋放資源。預設使用隔離執行環境。

### 請求標頭

在 `sessionRefererRules` 宣告所需的來源頁面規則。使用受管理的 ID 範圍 `41000`–`41999`，以及已宣告的網站網域與來源。規則只套用至擴充功能請求。

### 圖片轉換

在定義檔中宣告圖片轉換，並在離屏執行階段實作。測試分格、圖塊與頁面順序。封面需要不同的圖片處理時，實作 `cover.downloadImage`。

### 網站提供的圖片伺服器

對動態選擇的圖片主機，宣告 `originKind: "provider-issued"`，並在網站提供網址的邊界進行驗證。固定端點來源放在 `requiredOrigins`；選用主機模式放在 `optionalOrigins`。
