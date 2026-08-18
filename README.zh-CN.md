<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫画下载器

**从 Chrome 侧边栏批量下载漫画章节。排队、重试并导出 CBZ 或 ZIP 文件 — 无需离开阅读标签页。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[开始使用](#开始使用) · [功能](#功能) · [支持的网站](#支持的网站) · [Wiki](https://github.com/oovz/Tako/wiki) · [隐私](#隐私)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 功能

- **侧边栏命令中心** — 章节选择、队列状态和下载进度直接在 Chrome 侧边栏中操作，就在你阅读的页面旁边；完整历史与详细设置可通过选项页面管理。
- **真正的队列与重试** — 排队数十个章节，查看每张图片的进度，自动或手动重试失败的下载，同一时间保持稳定处理。
- **干净灵活的导出** — 默认保存为 CBZ 或 ZIP 压缩包，也可选择散装图片文件夹。直接保存到 Chrome 下载目录，或通过 File System Access API 写入本地漫画库文件夹。
- **ComicInfo.xml 元数据** — 自动在 CBZ 归档中嵌入系列信息、章节编号与标题等元数据，无缝兼容 Komga、Kavita 及现代漫画阅读器。
- **自定义路径与命名模板** — 支持使用 `<SERIES_TITLE>`、`<CHAPTER_NUMBER>`、`<VOLUME_NUMBER>` 等模板宏自动整理归档文件。
- **优化的站点集成** — 针对各个支持网站的页面结构、图片传输与元数据进行专门适配，确保高效与准确。
- **统一设置页面** — 在选项页面中集中配置全局默认与分站点覆盖的下载格式、路径模板、并发与速率限制。
- **隐私优先** — 无任何开发者统计、分析或遥测。设置、队列状态和下载历史全部保存在本地浏览器中。

## 支持的网站

| 网站                                                | 状态 |
| --------------------------------------------------- | :--: |
| [MangaDex](https://mangadex.org)*                   |  ✅  |
| [Pixiv Comic](https://comic.pixiv.net)              |  ✅  |
| [Shonen Jump+](https://shonenjumpplus.com)          |  ✅  |
| [Manhuagui](https://www.manhuagui.com)              |  ✅  |
| [Comic Nettai](https://www.comicnettai.com)         |  ✅  |
| [MangaMillion](https://mangamillion.shueisha.co.jp) |  ✅  |

- 默认关闭；在选项页面中启用时需要可选 HTTPS 权限。
  想要支持新网站？欢迎[提交功能请求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)或贡献集成 — 参见[站点集成指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)。

## 权利与网站访问

Tako 仅用于在您自己浏览器会话中已可正常访问的受支持网站页面。

- 它**不是**用于绕过付费墙、登录限制、DRM 或版权控制的工具。
- 它**不会**授予您原本没有的访问权限。

## 开始使用

1. 从 [Chrome 应用商店](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb) 安装。
2. 打开受支持的漫画系列或章节页面。
3. 点击 Tako 图标打开侧边栏。
4. 选择需要的章节，点击**下载**。

详细步骤请参见[快速入门指南](https://github.com/oovz/Tako/wiki/Quick-Start)。

<details>
<summary><b>从源码安装</b></summary>

### 从 GitHub Releases

1. 前往仓库的 **Releases** 页面，下载最新的 `tako-manga-downloader-vX.Y.Z-chrome.zip`。
2. 将压缩包解压到本地文件夹。
3. 打开 `chrome://extensions`。
4. 启用右上角的**开发者模式**。
5. 选择**加载已解压的扩展程序**，选中解压后的文件夹。

### 本地构建

Tako 当前针对 Chrome 150 或更高版本。本地构建需要 Node.js 20.19+（或 Node.js 22.12+）以及 pnpm 10.32.1。

```powershell
pnpm install
pnpm build
```

然后打开 `chrome://extensions`，启用**开发者模式**，选择**加载已解压的扩展程序**，选中 `.output\chrome-mv3`。

</details>

<details>
<summary><b>开发</b></summary>

```powershell
pnpm dev # WXT 开发服务器（热重载）
pnpm test:unit # 单元测试（Vitest）
pnpm test:e2e # E2E 测试（Playwright）
pnpm lint # ESLint 与架构检查
pnpm type-check # TypeScript 严格检查
```

完整的开发流程、代码规范和 PR 指南请参见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

</details>

## 文档

| Wiki 页面                                                                | 说明                           |
| ------------------------------------------------------------------------ | ------------------------------ |
| [快速入门](https://github.com/oovz/Tako/wiki/Quick-Start)                | 安装与首次下载指南             |
| [支持的网站](https://github.com/oovz/Tako/wiki/Supported-Sites)          | 当前站点集成与状态             |
| [对比](https://github.com/oovz/Tako/wiki/Comparisons)                    | Tako 与其他漫画下载器的对比    |
| [模板宏](https://github.com/oovz/Tako/wiki/Template-Macros)              | 文件名与路径模板宏参考         |
| [架构](https://github.com/oovz/Tako/wiki/Architecture)                   | 核心运行时、存储、消息与状态流 |
| [权限](https://github.com/oovz/Tako/wiki/Permissions)                    | 申请各项权限的说明             |
| [站点集成指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | 添加与维护站点集成             |

## 隐私

Tako 将设置、队列状态和历史记录保存在本地浏览器中。网络请求直接发送到受支持的网站及下载所需的相关基础设施，不包含由开发者运营的分析或遥测服务。启用 MangaDex 时，所需的 MangaDex@Home 报告会直接发送给 MangaDex。

完整隐私政策请参见 [`PRIVACY.md`](PRIVACY.md)。

## 贡献

欢迎贡献！提交 Pull Request 前请阅读[`贡献指南`](CONTRIBUTING.md)。

## 许可证

MIT — 详情参见 [`LICENSE`](LICENSE)。
