# 支援網站

[English](Supported-Sites) · [日本語](Supported-Sites.ja) · [简体中文](Supported-Sites.zh-CN) · [繁體中文](Supported-Sites.zh-TW) · [한국어](Supported-Sites.ko)

> 本頁由[英文原文](Supported-Sites)機器翻譯而成。

下表列出了 Tako 能辨識漫畫的頁面類型。開啟支援的頁面，再點選 Tako 圖示以選取章節。

## 網站清單

| 網站                                              | 支援的頁面類型     | 預設可用     |
| ------------------------------------------------- | ------------------ | ------------ |
| MangaDex                                          | 漫畫作品頁         | 在選項中啟用 |
| pixiv COMIC（pixivコミック）                      | 作品頁             | 是           |
| Shonen Jump+（少年ジャンプ＋）                    | 單篇頁面           | 是           |
| ManHuaGui（看漫画/漫画柜）                        | 漫畫詳細資料頁     | 是           |
| COMIC nettai（COMIC熱帯）                         | 書籍頁             | 是           |
| MANGA MILLION                                     | 作品頁             | 是           |
| FUHOUSE（香香腐宅）                               | 書籍詳情頁         | 是           |
| Mangago                                           | 作品頁             | 是           |
| MangaNato                                         | 作品頁             | 是           |
| MangaKakalot                                      | 作品頁             | 是           |
| Coolmic                                           | 網頁版作品頁       | 是           |
| MANGA Plus by SHUEISHA                            | 網頁版作品頁       | 是           |
| DM5（动漫屋）                                     | 作品頁             | 是           |
| [zaimanhua（再漫画）](https://www.zaimanhua.com/) | 漫畫詳情頁或閱讀頁 | 是           |
| copy3000（拷貝漫畫）                              | 作品頁             | 是           |
| MYCOMIC（我的漫畫）                               | 作品頁             | 是           |
| mangabz（Māngabz）                                | 作品頁             | 是           |
| MangaHere                                         | 作品頁             | 是           |
| aimanhua（我爱漫画）                              | 漫畫詳情頁         | 是           |

## 網域與章節歷史

- **zaimanhua（再漫画）：** 同一作品與章節的歷史在 `www.zaimanhua.com` 與 `manhua.zaimanhua.com` 之間共用。
- **copy3000（拷貝漫畫）：** 同一作品與章節的歷史在 `www.copy3000.com` 與 `www.copy4000.com` 之間共用。
- **MangaHere：** 請開啟 `newm.mangahere.cc`。舊版 `m.mangahere.cc` 閱讀器不受支援。
- **MangaNato 與 MangaKakalot：** 各自在「選項 → 網站整合」中設有獨立開關，章節歷史也各自獨立。
- **ManHuaGui（看漫画/漫画柜）：** 支援 `www.manhuagui.com` 與 `manhuagui.com`。請開啟漫畫詳細資料頁以選取章節。

## 啟用 MangaDex

1. 開啟 Tako 的「選項 → 網站整合」。
2. 啟用 MangaDex，並同意 Chrome 的網站存取要求。
3. 點選「儲存變更」。
4. 返回 MangaDex 作品頁，再開啟 Tako。

MangaDex 使用位址會變動的圖片伺服器，因此 Chrome 會要求存取 HTTPS 網站。詳情請參閱[權限說明](Permissions.zh-TW)。你也可以保持 MangaDex 停用，繼續使用其他網站。

## 網站存取與無法使用的章節

章節是否可用，取決於網站的網頁版閱讀器、你的存取權限，以及地區或帳號限制。部分整合會沿用網站現有的瀏覽器工作階段。需要時請先在網站登入，並在下載期間保持工作階段穩定。付費或受限制的章節，也必須能透過該網站的網頁版閱讀器存取。網站與應用程式的訂閱條款可能不同。

ManHuaGui（看漫画/漫画柜）除了帳號登入外，另有成人內容同意提示。請先在網站完成成人內容同意步驟，再於 Tako 重新開啟漫畫詳細資料頁。

copy3000（拷貝漫畫）可能暫時回傳空白章節清單，其網站的訪客閱讀器也可能出現相同情況。此時請等待網站恢復顯示章節，再於 Tako 重新載入作品頁。

若 Tako 找不到作品，請確認頁面類型符合上方表格。例如，MangaDex 需要作品頁，ManHuaGui（看漫画/漫画柜）需要漫畫詳細資料頁。若仍無法載入清單，請參閱[疑難排解](Troubleshooting.zh-TW)。

網站的頁面與圖片服務可能會變更。請透過[錯誤回報表單](https://github.com/oovz/Tako/issues/new?template=bug_report.md)提供網站名稱及公開範例網址，回報問題。

## 建議新增網站

[在 GitHub 建議支援網站](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。貢獻者可參閱[網站整合指南](Site-Integration-Guide.zh-TW)新增支援。
