<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫畫下載器

**從 Chrome 側邊欄批次下載漫畫章節。排隊、重試並匯出 CBZ/ZIP 檔案 — 無需離開閱讀分頁。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[安裝](#開始使用) · [功能](#功能) · [支援的網站](#支援的網站) · [Wiki](https://github.com/oovz/Tako/wiki) · [隱私](#隱私)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 功能

- **側邊欄命令中心** — 章節選擇、佇列和進度都在 Chrome 側邊欄中，就在你閱讀的頁面旁邊。無需額外分頁，無需反覆儲存對話框。
- **真正的佇列與重試** — 排隊數十個章節，查看每張圖片的進度，自動或手動重試失敗的下載。同一時間只處理一個任務，保持穩定。
- **乾淨的匯出** — 儲存為 CBZ、ZIP 或散裝圖片資料夾。自訂路徑和檔名範本相容 Komga、Kavita、Calibre 等庫管理工具。
- **優化的網站整合** — 每個支援的網站都有針對性的頁面結構、圖片 CDN 和詮釋資料處理 — 而非通用抓取。
- **統一設定頁面** — 輸出格式、範本、速率限制和重試的全域預設值與網站覆蓋都在選項頁面中。
- **檔案系統存取支援** — 選擇自訂下載資料夾，Tako 直接寫入。需要時回退到 Chrome 下載列。
- **ComicInfo.xml 產生** — 在 CBZ 封存中嵌入系列詮釋資料、章節編號、作者等資訊，相容漫畫庫管理器。
- **隱私優先** — 無分析、無遙測、無資料收集。一切都在本地瀏覽器中。

## 支援的網站

| 網站 | 狀態 |
|---|:---:|
| [MangaDex](https://mangadex.org) | ✅ |
| [Pixiv Comic](https://comic.pixiv.net) | ✅ |
| [Shonen Jump+](https://shonenjumpplus.com) | ✅ |
| [Manhuagui](https://www.manhuagui.com) | ✅ |
| [Comic Nettai](https://comic-nettai.com) | ✅ |

想要新網站？[提交請求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)或貢獻整合 — 參見[網站整合指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)。

## 權利與網站存取

Tako 僅用於在您自己瀏覽器工作階段中已可存取的支援網站頁面。

- 它**不是**用於繞過付費牆、登入限制、DRM 或版權控制的工具。
- 它**不會**授予您原本沒有的存取權限。

## 開始使用

1. 從 [Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)安裝。
2. 開啟一個受支援的漫畫系列頁面。
3. 點擊 Tako 圖示開啟側邊欄。
4. 選擇章節，點擊**下載**，查看佇列。

詳細步驟請參見[快速入門 Wiki 頁面](https://github.com/oovz/Tako/wiki/Quick-Start)。

<details>
<summary><b>從原始碼安裝</b></summary>

### 從 GitHub Releases

1. 前往倉庫的 **Releases** 頁面，下載最新的 `tako-manga-downloader-vX.Y.Z-chrome.zip`。
2. 將 zip 解壓縮到本機資料夾。
3. 開啟 `chrome://extensions`。
4. 啟用**開發者模式**。
5. 選擇**載入未封裝擴充功能**，選中解壓縮後的資料夾。

### 本機建置

```powershell
pnpm install
pnpm build
```

然後開啟 `chrome://extensions`，啟用**開發者模式**，選擇**載入未封裝擴充功能**，選中 `.output\chrome-mv3`。

</details>

<details>
<summary><b>開發</b></summary>

```powershell
pnpm dev          # WXT 開發伺服器（熱重載）
pnpm test:unit    # 單元測試（Vitest）
pnpm test:e2e     # E2E 測試（Playwright，模擬路由）
pnpm lint         # ESLint
pnpm type-check   # TypeScript 嚴格模式
```

完整的開發流程、程式碼風格規則和 PR 指南請參見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

</details>

## 文件

| Wiki 頁面 | 說明 |
|---|---|
| [快速入門](https://github.com/oovz/Tako/wiki/Quick-Start) | 安裝和首次下載指南 |
| [支援的網站](https://github.com/oovz/Tako/wiki/Supported-Sites) | 目前網站整合和狀態 |
| [比較](https://github.com/oovz/Tako/wiki/Comparisons) | Tako 與其他漫畫下載器的比較 |
| [範本巨集](https://github.com/oovz/Tako/wiki/Template-Macros) | 檔名和路徑範本巨集參考 |
| [架構](https://github.com/oovz/Tako/wiki/Architecture) | 核心執行階段、儲存、訊息和狀態流 |
| [權限](https://github.com/oovz/Tako/wiki/Permissions) | 各請求權限的用途 |
| [網站整合指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | 新增或維護網站整合 |

## 隱私

Tako 將設定、佇列狀態和歷史記錄儲存在本地瀏覽器中。網路請求直接發送到受支援的網站及下載所需的相關基礎設施。無分析後端、無遙測、無資料收集。

完整隱私政策請參見 [`PRIVACY.md`](PRIVACY.md)。

## 貢獻

歡迎貢獻。提交 Pull Request 前請閱讀[`貢獻指南`](CONTRIBUTING.md)。

## 授權條款

MIT — 詳情請參見 [`LICENSE`](LICENSE)。
