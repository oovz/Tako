# Supported Sites

[English](Supported-Sites) · [日本語](Supported-Sites.ja) · [简体中文](Supported-Sites.zh-CN) · [繁體中文](Supported-Sites.zh-TW) · [한국어](Supported-Sites.ko)

Open one of the pages below, then click the Tako icon to choose chapters. The page types identify the routes each integration recognizes.

## Existing integrations

| Site                                                        | Page to open       | Available by default |
| ----------------------------------------------------------- | ------------------ | -------------------- |
| [MangaDex](https://mangadex.org)                            | Manga title page   | Enable in Options    |
| [pixiv Comic (pixivコミック)](https://comic.pixiv.net)      | Work page          | Yes                  |
| [Shonen Jump+ (少年ジャンプ＋)](https://shonenjumpplus.com) | Episode page       | Yes                  |
| [Manhuagui (看漫画)](https://www.manhuagui.com)             | Comic details page | Yes                  |
| [Comic Nettai (COMIC熱帯)](https://www.comicnettai.com)     | Book page          | Yes                  |
| [MANGA MILLION](https://mangamillion.shueisha.co.jp)        | Title page         | Yes                  |

## Additional integrations

These sites are enabled by default. Chapter availability follows each site’s website reader and your access.

| Site                                                       | Page to open                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [BoyLove (香香腐宅)](https://boylove.cc)                   | Book details at `/home/book/index/id/{id}`                      |
| [Mangago](https://www.mangago.me)                          | Series at `/read-manga/{series}/`                               |
| [MangaNato](https://manganato.gg)                          | Series at `/manga/{series}`                                     |
| [MangaKakalot](https://mangakakalove.com)                  | Series at `/manga/{series}`                                     |
| [Coolmic](https://coolmic.me)                              | Website title at `/titles/{id}`                                 |
| [MANGA Plus by SHUEISHA](https://mangaplus.shueisha.co.jp) | Website title at `/titles/{id}`                                 |
| [Anime Manga House (动漫屋)](https://www.dm5.com)          | Series at `/manhua-{series}/`                                   |
| [Manga Again (再漫画)](https://www.zaimanhua.com)          | Comic details at `/info/{series}.html` or reader at `/view/...` |
| [CopyManga (拷貝漫畫)](https://www.copy3000.com)           | Series at `/comic/{series}`                                     |
| [MYCOMIC](https://mycomic.com)                             | Series at `/comics/{id}` or `/cn/comics/{id}`                   |
| [Māngabz](https://www.mangabz.com)                         | Series at `/{id}bz/`                                            |
| [MangaHere](https://newm.mangahere.cc)                     | Series at `/manga/{series}/`                                    |
| [Love Manga (爱漫画)](https://www.aimanhua.org)            | Comic details at `/comic/{id}`                                  |

## Domains and chapter history

- **Manga Again (再漫画):** `www.zaimanhua.com` and `manhua.zaimanhua.com` use one integration. Equivalent series and chapter IDs share chapter history across the two catalogs.
- **CopyManga (拷貝漫畫):** `www.copy3000.com` and `www.copy4000.com` use one integration. Equivalent series slugs and chapter UUIDs share chapter history across both domains.
- **MangaHere:** open `newm.mangahere.cc`. The current mobile reader supports volume-scoped chapter routes. The older `m.mangahere.cc` reader remains unsupported.
- **MangaNato and MangaKakalot:** each has its own switch in **Options → Site Integrations** and its own chapter history. Each site keeps its records even when series or chapter names match.
- **Manhuagui (看漫画):** both `www.manhuagui.com` and `manhuagui.com` are recognized. Open the comic details page to select chapters.

## Enable MangaDex

1. Open Tako's **Options → Site Integrations**.
2. Turn on MangaDex and accept Chrome's site-access request.
3. Click **Save Changes**.
4. Return to a MangaDex title page and open Tako.

MangaDex uses image servers with changing addresses, so Chrome asks for access to HTTPS sites. See [Permissions](Permissions) for details. You can leave MangaDex disabled and use the other sites.

## Website access and unavailable chapters

Chapter availability depends on the site's website reader, your access, and regional or account restrictions. Some integrations reuse the site's existing browser session. Sign in on the site when needed and keep that session stable while downloads run. For paid or restricted chapters, access must also be available through the site’s website reader. Website and app subscriptions can have different terms.

Manhuagui (看漫画) has an adult-content consent prompt as well as account login. Complete the prompt on the site before reopening its comic details page in Tako.

CopyManga (拷貝漫畫) can temporarily return an empty chapter list, including in its own guest website reader. If this happens, wait until the website displays the chapters again, then reload the series page in Tako.

KissManga is currently unsupported because its access challenge requires an interactive verification step.

If Tako can't find a series, check the page type in the tables above. For example, MangaDex needs a title page and Manhuagui (看漫画) needs a comic details page. Use [Troubleshooting](Troubleshooting) if the list still won't load.

Sites can change their pages and image services. Report a problem with the site name and a public example URL through the [bug report form](https://github.com/oovz/Tako/issues/new?template=bug_report.md).

## Request another site

[Suggest a site on GitHub](https://github.com/oovz/Tako/issues/new?template=feature_request.md). Contributors can use the [Site Integration Guide](Site-Integration-Guide) to add support.
