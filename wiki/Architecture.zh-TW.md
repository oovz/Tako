# 架構

[English](Architecture) · [日本語](Architecture.ja) · [简体中文](Architecture.zh-CN) · [繁體中文](Architecture.zh-TW) · [한국어](Architecture.ko)

> 本頁由[英文原文](Architecture)機器翻譯而成。

Tako 是使用 WXT 建置的 Manifest V3 擴充功能，適用於 Chrome 150 或更新版本。本頁協助貢獻者找到需要修改的程式碼。下載說明請見[快速開始](Quick-Start.zh-TW)與[疑難排解](Troubleshooting.zh-TW)。

## 擴充功能組成

| 元件                | 職責                                             |
| ------------------- | ------------------------------------------------ |
| 側邊面板與選項      | 章節選取、下載進度、歷史紀錄與設定               |
| 背景 Service Worker | 佇列管理、狀態儲存、權限與 Chrome 下載           |
| 離屏文件            | 取得與處理章節圖片、建立封存檔、儲存至自訂資料夾 |
| 網站整合            | 識別網站、解析作品資料與章節清單、處理圖片       |

## 原始碼導覽

| 修改內容           | 起點                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 側邊面板與選項     | [`entrypoints/sidepanel/`](https://github.com/oovz/Tako/tree/main/entrypoints/sidepanel), [`entrypoints/options/`](https://github.com/oovz/Tako/tree/main/entrypoints/options) |
| 背景任務           | [`entrypoints/background/`](https://github.com/oovz/Tako/tree/main/entrypoints/background)                                                                                     |
| 圖片處理與封存     | [`entrypoints/offscreen/`](https://github.com/oovz/Tako/tree/main/entrypoints/offscreen)                                                                                       |
| 網站支援           | [`src/site-integrations/`](https://github.com/oovz/Tako/tree/main/src/site-integrations)                                                                                       |
| 領域邏輯           | [`src/domain/`](https://github.com/oovz/Tako/tree/main/src/domain)                                                                                                             |
| 設定與歷史紀錄儲存 | [`src/storage/`](https://github.com/oovz/Tako/tree/main/src/storage)                                                                                                           |
| 共用執行階段服務   | [`src/runtime/`](https://github.com/oovz/Tako/tree/main/src/runtime)                                                                                                           |
| 網站介面           | [`src/types/site-integrations.ts`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)                                                                      |

開發環境設定與測試請見[貢獻指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)。新增網站支援請參閱[網站整合指南](Site-Integration-Guide.zh-TW)。

## 參考資料

- [Chrome 擴充功能 Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome 側邊面板 API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome 離屏 API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome 下載 API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
