<div align="center">

<img src="public/icon/128.png" alt="Tako" width="128" />

# Tako 漫画下载器

**从 Chrome 侧边栏批量下载漫画章节。排队、重试并导出 CBZ/ZIP 文件 — 无需离开阅读标签页。**

[![Chrome Web Store](https://developer.chrome.com/static/docs/webstore/branding/image/tbyBjqi7Zu733AAKA5n4.png)](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/intro/)

[安装](#开始使用) · [功能](#功能) · [支持的网站](#支持的网站) · [Wiki](https://github.com/oovz/Tako/wiki) · [隐私](#隐私)

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md)

</div>

---

## 功能

- **侧边栏命令中心** — 章节选择、队列和进度都在 Chrome 侧边栏中，就在你阅读的页面旁边。无需额外标签页，无需反复保存对话框。
- **真正的队列与重试** — 排队数十个章节，查看每张图片的进度，自动或手动重试失败的下载。同一时间只处理一个任务，保持稳定。
- **干净的导出** — 保存为 CBZ、ZIP 或散装图片文件夹。自定义路径和文件名模板兼容 Komga、Kavita、Calibre 等库管理工具。
- **优化的站点集成** — 每个支持的网站都有针对性的页面结构、图片 CDN 和元数据处理 — 而非通用抓取。
- **统一设置页面** — 输出格式、模板、速率限制和重试的全局默认值与站点覆盖都在选项页面中。
- **文件系统访问支持** — 选择自定义下载文件夹，Tako 直接写入。需要时回退到 Chrome 下载栏。
- **ComicInfo.xml 生成** — 在 CBZ 归档中嵌入系列元数据、章节编号、作者等信息，兼容漫画库管理器。
- **隐私优先** — 无分析、无遥测、无数据收集。一切都在本地浏览器中。

## 支持的网站

| 网站 | 状态 |
|---|:---:|
| [MangaDex](https://mangadex.org) | ✅ |
| [Pixiv Comic](https://comic.pixiv.net) | ✅ |
| [Shonen Jump+](https://shonenjumpplus.com) | ✅ |
| [Manhuagui](https://www.manhuagui.com) | ✅ |
| [Comic Nettai](https://comic-nettai.com) | ✅ |

想要新网站？[提交请求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)或贡献集成 — 参见[站点集成指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide)。

## 权利与网站访问

Tako 仅用于在您自己浏览器会话中已可访问的受支持网站页面。

- 它**不是**用于绕过付费墙、登录限制、DRM 或版权控制的工具。
- 它**不会**授予您原本没有的访问权限。

## 开始使用

1. 从 [Chrome 应用商店](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)安装。
2. 打开一个受支持的漫画系列页面。
3. 点击 Tako 图标打开侧边栏。
4. 选择章节，点击**下载**，查看队列。

详细步骤请参见[快速入门 Wiki 页面](https://github.com/oovz/Tako/wiki/Quick-Start)。

<details>
<summary><b>从源码安装</b></summary>

### 从 GitHub Releases

1. 前往仓库的 **Releases** 页面，下载最新的 `tako-manga-downloader-vX.Y.Z-chrome.zip`。
2. 将 zip 解压到本地文件夹。
3. 打开 `chrome://extensions`。
4. 启用**开发者模式**。
5. 选择**加载已解压的扩展程序**，选中解压后的文件夹。

### 本地构建

```powershell
pnpm install
pnpm build
```

然后打开 `chrome://extensions`，启用**开发者模式**，选择**加载已解压的扩展程序**，选中 `.output\chrome-mv3`。

</details>

<details>
<summary><b>开发</b></summary>

```powershell
pnpm dev          # WXT 开发服务器（热重载）
pnpm test:unit    # 单元测试（Vitest）
pnpm test:e2e     # E2E 测试（Playwright，模拟路由）
pnpm lint         # ESLint
pnpm type-check   # TypeScript 严格模式
```

完整的开发流程、代码风格规则和 PR 指南请参见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

</details>

## 文档

| Wiki 页面 | 说明 |
|---|---|
| [快速入门](https://github.com/oovz/Tako/wiki/Quick-Start) | 安装和首次下载指南 |
| [支持的网站](https://github.com/oovz/Tako/wiki/Supported-Sites) | 当前站点集成和状态 |
| [对比](https://github.com/oovz/Tako/wiki/Comparisons) | Tako 与其他漫画下载器的对比 |
| [模板宏](https://github.com/oovz/Tako/wiki/Template-Macros) | 文件名和路径模板宏参考 |
| [架构](https://github.com/oovz/Tako/wiki/Architecture) | 核心运行时、存储、消息和状态流 |
| [权限](https://github.com/oovz/Tako/wiki/Permissions) | 各请求权限的用途 |
| [站点集成指南](https://github.com/oovz/Tako/wiki/Site-Integration-Guide) | 添加或维护站点集成 |

## 隐私

Tako 将设置、队列状态和历史记录存储在本地浏览器中。网络请求直接发送到受支持的网站及下载所需的相关基础设施。无分析后端、无遥测、无数据收集。

完整隐私政策请参见 [`PRIVACY.md`](PRIVACY.md)。

## 贡献

欢迎贡献。提交 Pull Request 前请阅读[`贡献指南`](CONTRIBUTING.md)。

## 许可证

MIT — 详情参见 [`LICENSE`](LICENSE)。
