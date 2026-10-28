# 支援網站

[English](Supported-Sites) · [日本語](Supported-Sites.ja) · [简体中文](Supported-Sites.zh-CN) · [繁體中文](Supported-Sites.zh-TW) · [한국어](Supported-Sites.ko)

> 本頁由[英文原文](Supported-Sites)機器翻譯而成。

開啟下列任一頁面，再點選 Tako 圖示以選取章節。頁面類型列出了各整合可識別的路徑。

## 既有整合

| 網站                                                         | 應開啟的頁面   | 預設可用     |
| ------------------------------------------------------------ | -------------- | ------------ |
| [MangaDex](https://mangadex.org)                             | 漫畫作品頁     | 在選項中啟用 |
| [pixiv Comic（pixivコミック）](https://comic.pixiv.net)      | 作品頁         | 是           |
| [Shonen Jump+（少年ジャンプ＋）](https://shonenjumpplus.com) | 單篇頁面       | 是           |
| [Manhuagui（看漫画）](https://www.manhuagui.com)             | 漫畫詳細資料頁 | 是           |
| [Comic Nettai（COMIC熱帯）](https://www.comicnettai.com)     | 書籍頁         | 是           |
| [MANGA MILLION](https://mangamillion.shueisha.co.jp)         | 作品頁         | 是           |

## 其他整合

下列網站預設啟用。章節是否可用，取決於各網站的網頁版閱讀器與你的存取權限。

| 網站                                                       | 應開啟的頁面                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| [BoyLove（香香腐宅）](https://boylove.cc)                  | 書籍詳細資料：`/home/book/index/id/{id}`                   |
| [Mangago](https://www.mangago.me)                          | 作品：`/read-manga/{series}/`                              |
| [MangaNato](https://manganato.gg)                          | 作品：`/manga/{series}`                                    |
| [MangaKakalot](https://mangakakalove.com)                  | 作品：`/manga/{series}`                                    |
| [Coolmic](https://coolmic.me)                              | 網頁版作品：`/titles/{id}`                                 |
| [MANGA Plus by SHUEISHA](https://mangaplus.shueisha.co.jp) | 網頁版作品：`/titles/{id}`                                 |
| [Anime Manga House（动漫屋）](https://www.dm5.com)         | 作品：`/manhua-{series}/`                                  |
| [Manga Again（再漫画）](https://www.zaimanhua.com)         | 漫畫詳細資料：`/info/{series}.html`，或閱讀器：`/view/...` |
| [CopyManga（拷貝漫畫）](https://www.copy3000.com)          | 作品：`/comic/{series}`                                    |
| [MYCOMIC](https://mycomic.com)                             | 作品：`/comics/{id}` 或 `/cn/comics/{id}`                  |
| [Māngabz](https://www.mangabz.com)                         | 作品：`/{id}bz/`                                           |
| [MangaHere](https://newm.mangahere.cc)                     | 作品：`/manga/{series}/`                                   |
| [Love Manga（爱漫画）](https://www.aimanhua.org)           | 漫畫詳細資料：`/comic/{id}`                                |

## 網域與章節歷史

- **Manga Again（再漫画）：** `www.zaimanhua.com` 與 `manhua.zaimanhua.com` 使用同一個整合。兩個目錄中相同的作品與章節 ID 共用章節歷史。
- **CopyManga（拷貝漫畫）：** `www.copy3000.com` 與 `www.copy4000.com` 使用同一個整合。兩個網域中相同的作品識別字串與章節 UUID 共用章節歷史。
- **MangaHere：** 請開啟 `newm.mangahere.cc`。目前的行動版閱讀器支援按卷區分的章節路徑，舊版 `m.mangahere.cc` 閱讀器仍未受支援。
- **MangaNato 與 MangaKakalot：** 各自在「選項 → 網站整合」中擁有開關與章節歷史。即使作品或章節名稱相同，各網站仍保留各自的紀錄。
- **Manhuagui（看漫画）：** 支援 `www.manhuagui.com` 與 `manhuagui.com`。請開啟漫畫詳細資料頁以選取章節。

## 啟用 MangaDex

1. 開啟 Tako 的「選項 → 網站整合」。
2. 開啟 MangaDex，並同意 Chrome 的網站存取要求。
3. 點選「儲存變更」。
4. 返回 MangaDex 作品頁，再開啟 Tako。

MangaDex 使用位址會變動的圖片伺服器，因此 Chrome 會要求存取 HTTPS 網站。詳情請參閱[權限說明](Permissions.zh-TW)。你也可以保持 MangaDex 停用，繼續使用其他網站。

## 網站存取與無法使用的章節

章節是否可用，取決於網站的網頁版閱讀器、你的存取權限，以及地區或帳號限制。部分整合會沿用網站現有的瀏覽器工作階段。需要時請先在網站登入，並在下載期間保持工作階段穩定。付費或受限制的章節，也必須能透過該網站的網頁版閱讀器存取。網站與應用程式的訂閱條款可能不同。

Manhuagui（看漫画）除了帳號登入外，另有成人內容同意提示。請先在網站完成該提示，再於 Tako 重新開啟漫畫詳細資料頁。

CopyManga（拷貝漫畫）可能暫時回傳空白章節清單，其網站的訪客閱讀器也可能出現相同情況。此時請等待網站恢復顯示章節，再於 Tako 重新載入作品頁。

KissManga 目前未受支援，因為其存取驗證需要互動操作。

若 Tako 找不到作品，請確認頁面類型符合上方表格。例如，MangaDex 需要作品頁，Manhuagui（看漫画）需要漫畫詳細資料頁。若仍無法載入清單，請參閱[疑難排解](Troubleshooting.zh-TW)。

網站的頁面與圖片服務可能會變更。請透過[錯誤回報表單](https://github.com/oovz/Tako/issues/new?template=bug_report.md)提供網站名稱及公開範例網址，回報問題。

## 建議新增網站

[在 GitHub 建議支援網站](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。貢獻者可參閱[網站整合指南](Site-Integration-Guide.zh-TW)新增支援。
