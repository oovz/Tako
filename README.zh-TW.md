<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫畫下載器

**從 Chrome 側邊欄批次下載漫畫章節。排隊、重試並匯出 CBZ 或 ZIP 檔案 — 無需離開閱讀分頁。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[開始使用](#開始使用) · [功能](#功能) · [支援的網站](#支援的網站) · [Wiki](https://github.com/oovz/Tako/wiki) · [隱私](#隱私)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 功能

- **側邊欄命令中心** — 章節選擇、佇列狀態和下載進度直接在 Chrome 側邊欄中操作，就在你閱讀的頁面旁邊；完整歷史與詳細設定可透過選項頁面管理。
- **真正的佇列與重試** — 排隊數十個章節，查看每張圖片的進度，自動或手動重試失敗的下載，同一時間保持穩定處理。
- **乾淨靈活的匯出** — 預設儲存為 CBZ 或 ZIP 壓縮檔，也可選擇散裝圖片資料夾。直接儲存到 Chrome 下載目錄，或透過 File System Access API 寫入本機漫畫庫資料夾。
- **ComicInfo.xml 詮釋資料** — 自動在 CBZ 封存中嵌入系列資訊、章節編號與標題等詮釋資料，無縫相容 Komga、Kavita 及現代漫畫閱讀器。
- **自訂路徑與命名範本** — 支援使用 `<SERIES_TITLE>`、`<CHAPTER_NUMBER>`、`<VOLUME_NUMBER>` 等範本巨集自動整理封存檔案。
- **最佳化的網站整合** — 針對各個支援網站的頁面結構、圖片傳輸與詮釋資料進行專門適配，確保高效與準確。
- **統一設定頁面** — 在選項頁面中集中設定全域預設與個別網站覆蓋的下載格式、路徑範本、並發與速率限制。
- **隱私優先** — 無任何開發者統計、分析或遙測。設定、佇列狀態和下載歷史全部保存在本機瀏覽器中。

## 支援的網站

| 網站                                                | 狀態 |
| --------------------------------------------------- | :--: |
| [MangaDex](https://mangadex.org)*                   |  ✅  |
| [Pixiv Comic](https://comic.pixiv.net)              |  ✅  |
| [Shonen Jump+](https://shonenjumpplus.com)          |  ✅  |
| [Manhuagui](https://www.manhuagui.com)              |  ✅  |
| [Comic Nettai](https://www.comicnettai.com)         |  ✅  |
| [MangaMillion](https://mangamillion.shueisha.co.jp) |  ✅  |

- 預設關閉；在選項頁面中啟用時需要選用 HTTPS 權限。
  想要支援新網站？歡迎[提出功能請求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)或貢獻整合 — 參見[網站整合指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)。

## 權利與網站存取

Tako 僅用於在您自己瀏覽器工作階段中已可正常存取的支援網站頁面。

- 它**不是**用於繞過付費牆、登入限制、DRM 或版權控制的工具。
- 它**不會**授予您原本沒有的存取權限。

## 開始使用

1. 從 [Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) 安裝。
2. 開啟受支援的漫畫系列或章節頁面。
3. 點擊 Tako 圖示開啟側邊欄。
4. 選擇需要的章節，點擊**下載**。

詳細步驟請參見[快速入門指南](https://github.com/oovz/Tako/wiki/Quick-Start)。

<details>
<summary><b>從原始碼安裝</b></summary>

### 從 GitHub Releases

1. 前往存放庫的 **Releases** 頁面，下載最新的 `tako-manga-downloader-vX.Y.Z-chrome.zip`。
2. 將壓縮檔解壓縮到本機資料夾。
3. 開啟 `chrome://extensions`。
4. 啟用右上角的**開發人員模式**。
5. 選擇**載入未打包項目**，選取解壓縮後的資料夾。

### 本機建置

Tako 目前針對 Chrome 150 或更高版本。本機建置需要 Node.js 20.19+（或 Node.js 22.12+）以及 pnpm 10.32.1。

```powershell
pnpm install
pnpm build
```

然後開啟 `chrome://extensions`，啟用**開發人員模式**，選擇**載入未打包項目**，選取 `.output\chrome-mv3`。

</details>

<details>
<summary><b>開發</b></summary>

```powershell
pnpm dev # WXT 開發伺服器（熱重載）
pnpm test:unit # 單元測試（Vitest）
pnpm test:e2e # E2E 測試（Playwright）
pnpm lint # ESLint 與架構檢查
pnpm type-check # TypeScript 嚴格檢查
```

完整的開發流程、程式碼規範和 PR 指南請參見 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

</details>

## 文件

| Wiki 頁面                                                                | 說明                             |
| ------------------------------------------------------------------------ | -------------------------------- |
| [快速入門](https://github.com/oovz/Tako/wiki/Quick-Start)                | 安裝與首次下載指南               |
| [支援的網站](https://github.com/oovz/Tako/wiki/Supported-Sites)          | 目前網站整合與狀態               |
| [比較](https://github.com/oovz/Tako/wiki/Comparisons)                    | Tako 與其他漫畫下載器的比較      |
| [範本巨集](https://github.com/oovz/Tako/wiki/Template-Macros)            | 檔名與路徑範本巨集參考           |
| [架構](https://github.com/oovz/Tako/wiki/Architecture)                   | 核心執行階段、儲存、訊息與狀態流 |
| [權限](https://github.com/oovz/Tako/wiki/Permissions)                    | 申請各項權限的說明               |
| [網站整合指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | 新增與維護網站整合               |

## 隱私

Tako 將設定、佇列狀態和歷史記錄儲存在本機瀏覽器中。網路請求直接傳送到受支援的網站及下載所需的相關基礎設施，不包含由開發者營運的分析或遙測服務。啟用 MangaDex 時，所需的 MangaDex@Home 報告會直接傳送給 MangaDex。

完整隱私權政策請參見 [`PRIVACY.md`](PRIVACY.md)。

## 貢獻

歡迎貢獻！提交 Pull Request 前請閱讀[`貢獻指南`](CONTRIBUTING.md)。

## 授權條款

MIT — 詳情請參見 [`LICENSE`](LICENSE)。
