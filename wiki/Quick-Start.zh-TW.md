# 快速開始

[English](Quick-Start) · [日本語](Quick-Start.ja) · [简体中文](Quick-Start.zh-CN) · [繁體中文](Quick-Start.zh-TW) · [한국어](Quick-Start.ko)

> 本頁由[英文原文](Quick-Start)機器翻譯而成。

## 安裝 Tako

部分支援網站含有年齡限制的內容。如果 Chrome 線上應用程式商店將 Tako 標為成人內容，請登入符合年齡要求的 Google 帳戶再安裝。

1. 使用 Chrome 150 或更新版本，開啟 [Chrome 線上應用程式商店的 Tako 頁面](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)。
2. 點選「加到 Chrome」。
3. 開啟 Chrome 擴充功能選單並固定 Tako，方便找到它的圖示。

<details>
<summary>安裝 GitHub 發行版本</summary>

1. 開啟 [GitHub Releases](https://github.com/oovz/Tako/releases)，下載所需版本的 Chrome ZIP 檔案。
2. 將檔案解壓縮至電腦上的資料夾。
3. 開啟 `chrome://extensions`，啟用「開發人員模式」。
4. 點選「載入未封裝項目」，選擇解壓縮後的資料夾。

只要 Chrome 中仍安裝著這個擴充功能，就請讓該資料夾留在原位置。本機建置方式請參閱[貢獻者設定指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#quick-setup)。

</details>

## 下載第一個章節

1. 開啟[支援網站](Supported-Sites.zh-TW)上的漫畫。多數網站使用作品頁；Shonen Jump+（少年ジャンプ＋）使用單篇頁面。
2. 點選 Tako 圖示，開啟 Chrome 側邊面板。
3. 選取想要的章節，再點選「下載」。
4. 在佇列查看進度。儲存完成後，結果會顯示「已儲存」或「已儲存至資料夾」。

Tako 預設透過 Chrome 下載功能儲存 CBZ 檔案。你可以使用相容的漫畫閱讀器開啟 CBZ。

> [!TIP]
> MangaDex 預設停用。請在「選項 → 網站整合」中啟用，同意 Chrome 的網站存取要求並點選「儲存變更」，再返回作品頁。

## 選擇格式

從側邊面板開啟「設定」，或在 Tako 圖示上按滑鼠右鍵並選擇「選項」。在「儲存空間與檔案」中選擇封存格式，再點選「儲存變更」。

| 格式       | 用途                         |
| ---------- | ---------------------------- |
| **CBZ**    | 使用漫畫閱讀器閱讀章節       |
| **ZIP**    | 將章節圖片保存在標準封存檔中 |
| **不封存** | 儲存個別圖片檔案             |

也可以加入作品封面與 ComicInfo.xml 中繼資料，供相容的閱讀器使用。[檔名範本](Template-Macros.zh-TW)可設定資料夾結構與章節命名方式。

## 選擇儲存資料夾

在「選項 → 儲存空間與檔案」中，保留「使用瀏覽器下載」即可使用 Chrome 的下載位置；或選擇「使用自訂資料夾（File System Access）」並選取資料夾。點選「儲存變更」，讓新下載使用這項設定。

下載期間也能變更這些預設設定。佇列中的任務會保留各自的資料夾與指定的檔名，重試或重新開始時也一樣。若要將章節儲存到其他位置，請變更預設設定並建立新任務。

「資料夾無法使用時改用 Chrome 下載」是套用至新任務的選用設定，預設關閉。只有在任務首次嘗試寫入所選資料夾之前，才能切換儲存目的地。

## 管理下載

若要再加一批，開啟另一部作品，或在目前的作品多選幾個章節，再點選「下載」。Tako 依佇列逐章處理。下載時請保持 Chrome 執行。

- 使用「重試失敗章節」，再次嘗試任務中未完成的部分。僅儲存部分內容的章節會從頭開始。
- 使用「重新開始任務」，再次下載該任務的所有章節。
- 使用「取消下載」，停止任務剩餘的工作。已儲存的檔案會留在磁碟上，Chrome 已接受的傳輸則會繼續由 Chrome 下載功能處理。
- 在選項中開啟「活動與歷史紀錄」，查看過往的任務與章節紀錄。

資料夾存取錯誤、中斷的工作或「先前已處理」結果，請參閱[疑難排解](Troubleshooting.zh-TW)。
