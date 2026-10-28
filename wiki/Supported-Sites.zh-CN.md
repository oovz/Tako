# 支持的网站

[English](Supported-Sites) · [日本語](Supported-Sites.ja) · [简体中文](Supported-Sites.zh-CN) · [繁體中文](Supported-Sites.zh-TW) · [한국어](Supported-Sites.ko)

> 本页由[英文原文](Supported-Sites)机器翻译而来。

打开下表中的页面，然后点击 Tako 图标选择章节。页面类型列说明各站点集成识别的路径。

## 原有站点集成

| 网站                                                         | 应打开的页面 | 默认可用     |
| ------------------------------------------------------------ | ------------ | ------------ |
| [MangaDex](https://mangadex.org)                             | 漫画作品页面 | 在选项中启用 |
| [pixiv Comic（pixivコミック）](https://comic.pixiv.net)      | 作品页面     | 是           |
| [Shonen Jump+（少年ジャンプ＋）](https://shonenjumpplus.com) | 单话页面     | 是           |
| [Manhuagui（看漫画）](https://www.manhuagui.com)             | 漫画详情页   | 是           |
| [Comic Nettai（COMIC熱帯）](https://www.comicnettai.com)     | 书籍页面     | 是           |
| [MANGA MILLION](https://mangamillion.shueisha.co.jp)         | 作品页面     | 是           |

## 新增站点集成

以下网站默认启用。章节是否可用取决于各网站的网页阅读器和你的访问权限。

| 网站                                                       | 应打开的页面                                              |
| ---------------------------------------------------------- | --------------------------------------------------------- |
| [BoyLove（香香腐宅）](https://boylove.cc)                  | `/home/book/index/id/{id}` 书籍详情页                     |
| [Mangago](https://www.mangago.me)                          | `/read-manga/{series}/` 系列页面                          |
| [MangaNato](https://manganato.gg)                          | `/manga/{series}` 系列页面                                |
| [MangaKakalot](https://mangakakalove.com)                  | `/manga/{series}` 系列页面                                |
| [Coolmic](https://coolmic.me)                              | `/titles/{id}` 网页作品页面                               |
| [MANGA Plus by SHUEISHA](https://mangaplus.shueisha.co.jp) | `/titles/{id}` 网页作品页面                               |
| [Anime Manga House（动漫屋）](https://www.dm5.com)         | `/manhua-{series}/` 系列页面                              |
| [Manga Again（再漫画）](https://www.zaimanhua.com)         | `/info/{series}.html` 漫画详情页或 `/view/...` 阅读器页面 |
| [CopyManga（拷貝漫畫）](https://www.copy3000.com)          | `/comic/{series}` 系列页面                                |
| [MYCOMIC](https://mycomic.com)                             | `/comics/{id}` 或 `/cn/comics/{id}` 系列页面              |
| [Māngabz](https://www.mangabz.com)                         | `/{id}bz/` 系列页面                                       |
| [MangaHere](https://newm.mangahere.cc)                     | `/manga/{series}/` 系列页面                               |
| [Love Manga（爱漫画）](https://www.aimanhua.org)           | `/comic/{id}` 漫画详情页                                  |

## 域名与章节历史

- **Manga Again（再漫画）：** `www.zaimanhua.com` 和 `manhua.zaimanhua.com` 使用同一个站点集成。两个目录中相同的系列和章节 ID 共用章节历史。
- **CopyManga（拷貝漫畫）：** `www.copy3000.com` 和 `www.copy4000.com` 使用同一个站点集成。两个域名中相同的系列路径名和章节 UUID 共用章节历史。
- **MangaHere：** 请打开 `newm.mangahere.cc`。当前移动阅读器支持按卷划分的章节路径。旧版 `m.mangahere.cc` 阅读器仍不受支持。
- **MangaNato 和 MangaKakalot：** 在**选项 → 站点集成**中各有独立开关，章节历史也各自独立。即使系列或章节同名，各网站仍保留各自的记录。
- **Manhuagui（看漫画）：** 同时识别 `www.manhuagui.com` 和 `manhuagui.com`。请打开漫画详情页选择章节。

## 启用 MangaDex

1. 打开 Tako 的**选项 → 站点集成**。
2. 启用 MangaDex，接受 Chrome 的网站访问请求。
3. 点击**保存更改**。
4. 返回 MangaDex 作品页面，打开 Tako。

MangaDex 使用地址会变化的图片服务器，因此 Chrome 会请求 HTTPS 网站访问权限。详情请参阅[权限说明](Permissions.zh-CN)。也可以保持 MangaDex 关闭，使用其他网站。

## 网站访问与不可用章节

章节是否可用取决于网站的网页阅读器、你的访问权限，以及地区或账户限制。部分站点集成复用网站已有的浏览器会话。需要时请先登录网站，并在下载期间保持该会话稳定。付费或受限章节也需要能通过网站的网页阅读器访问。网站和应用订阅的条款可能不同。

Manhuagui（看漫画）除了账户登录，还有成人内容同意提示。请先在网站上完成提示，再在 Tako 中重新打开漫画详情页。

CopyManga（拷貝漫畫）有时会暂时返回空章节列表，其访客网页阅读器也可能如此。遇到这种情况，请等待网站重新显示章节，再在 Tako 中重新加载系列页面。

KissManga 目前不受支持，因为其访问挑战需要交互式验证。

如果 Tako 找不到系列，请检查上表中的页面类型。例如，MangaDex 需要作品页面，Manhuagui（看漫画）需要漫画详情页。如果列表仍无法加载，请参阅[问题排查](Troubleshooting.zh-CN)。

网站的页面和图片服务可能发生变化。遇到问题时，请通过[错误报告表单](https://github.com/oovz/Tako/issues/new?template=bug_report.md)提供网站名称和公开的示例网址。

## 申请支持其他网站

[在 GitHub 上建议新网站](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。贡献者可以按照[站点集成指南](Site-Integration-Guide.zh-CN)添加支持。
