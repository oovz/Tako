# Supported Sites

[English](Supported-Sites) · [日本語](Supported-Sites.ja) · [简体中文](Supported-Sites.zh-CN) · [繁體中文](Supported-Sites.zh-TW) · [한국어](Supported-Sites.ko)

Tako detects manga on the page types listed below. Open a supported page, then click the Tako icon to choose chapters.

## Sites

| Site                                             | Supported page type     | Available by default |
| ------------------------------------------------ | ----------------------- | -------------------- |
| MangaDex                                         | Manga title page        | Enable in Options    |
| pixiv COMIC (pixivコミック)                      | Work page               | Yes                  |
| Shonen Jump+ (少年ジャンプ＋)                    | Episode page            | Yes                  |
| ManHuaGui (看漫画/漫画柜)                        | Comic details page      | Yes                  |
| COMIC nettai (COMIC熱帯)                         | Book page               | Yes                  |
| MANGA MILLION                                    | Title page              | Yes                  |
| FUHOUSE (香香腐宅)                               | Book details            | Yes                  |
| Mangago                                          | Series page             | Yes                  |
| MangaNato                                        | Series page             | Yes                  |
| MangaKakalot                                     | Series page             | Yes                  |
| Coolmic                                          | Website title page      | Yes                  |
| MANGA Plus by SHUEISHA                           | Website title page      | Yes                  |
| DM5 (动漫屋)                                     | Series page             | Yes                  |
| [zaimanhua (再漫画)](https://www.zaimanhua.com/) | Comic details or reader | Yes                  |
| copy3000 (拷貝漫畫)                              | Series page             | Yes                  |
| MYCOMIC (我的漫畫)                               | Series page             | Yes                  |
| mangabz (Māngabz)                                | Series page             | Yes                  |
| MangaHere                                        | Series page             | Yes                  |
| aimanhua (我爱漫画)                              | Comic details           | Yes                  |

## Domains and chapter history

- **zaimanhua (再漫画):** The same series and chapters share history across `www.zaimanhua.com` and `manhua.zaimanhua.com`.
- **copy3000 (拷貝漫畫):** The same series and chapters share history across `www.copy3000.com` and `www.copy4000.com`.
- **MangaHere:** open `newm.mangahere.cc`. The older `m.mangahere.cc` reader is unsupported.
- **MangaNato and MangaKakalot:** each has its own switch in **Options → Site Integrations** and its own chapter history.
- **ManHuaGui (看漫画/漫画柜):** both `www.manhuagui.com` and `manhuagui.com` are recognized. Open the comic details page to select chapters.

## Enable MangaDex

1. Open Tako's **Options → Site Integrations**.
2. Turn on MangaDex and accept Chrome's site-access request.
3. Click **Save Changes**.
4. Return to a MangaDex title page and open Tako.

MangaDex uses image servers with changing addresses, so Chrome asks for access to HTTPS sites. See [Permissions](Permissions) for details. You can leave MangaDex disabled and use the other sites.

## Website access and unavailable chapters

Chapter availability depends on the site's website reader, your access, and regional or account restrictions. Some integrations reuse the site's existing browser session. Sign in on the site when needed and keep that session stable while downloads run. For paid or restricted chapters, access must also be available through the site’s website reader. Website and app subscriptions can have different terms.

ManHuaGui (看漫画/漫画柜) has an adult-content consent prompt as well as account login. Complete the prompt on the site before reopening its comic details page in Tako.

copy3000 (拷貝漫畫) can temporarily return an empty chapter list, including in its own guest website reader. If this happens, wait until the website displays the chapters again, then reload the series page in Tako.

If Tako can't find a series, check the page type in the table above. For example, MangaDex needs a title page and ManHuaGui (看漫画/漫画柜) needs a comic details page. Use [Troubleshooting](Troubleshooting) if the list still won't load.

Sites can change their pages and image services. Report a problem with the site name and a public example URL through the [bug report form](https://github.com/oovz/Tako/issues/new?template=bug_report.md).

## Request another site

[Suggest a site on GitHub](https://github.com/oovz/Tako/issues/new?template=feature_request.md). Contributors can use the [Site Integration Guide](Site-Integration-Guide) to add support.
