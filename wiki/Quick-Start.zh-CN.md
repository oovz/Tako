# 快速入门

[English](Quick-Start) · [日本語](Quick-Start.ja) · [简体中文](Quick-Start.zh-CN) · [繁體中文](Quick-Start.zh-TW) · [한국어](Quick-Start.ko)

> 本页由[英文原文](Quick-Start)机器翻译而来。

## 安装 Tako

1. 在 Chrome 150 或更新版本中打开 [Tako 的 Chrome 应用商店页面](https://chromewebstore.google.com/detail/tako-manga-downloader/hlodmckfkmbenkknmailfekehgajpmbb)。
2. 点击**添加至 Chrome**。
3. 打开 Chrome 的扩展程序菜单，将 Tako 固定到工具栏，方便找到图标。

<details>
<summary>安装 GitHub 发布版本</summary>

1. 打开 [GitHub Releases](https://github.com/oovz/Tako/releases)，下载所需版本的 Chrome ZIP 文件。
2. 将文件解压到电脑上的一个文件夹。
3. 打开 `chrome://extensions`，启用**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择解压后的文件夹。

只要 Chrome 中还安装着这个扩展，就请将该文件夹保留在原位置。本地构建请参阅[贡献者环境配置指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#quick-setup)。

</details>

## 下载你的第一章

1. 在[支持的网站](Supported-Sites.zh-CN)打开漫画。多数网站使用系列页面；Shonen Jump+（少年ジャンプ＋）使用单话页面。
2. 点击 Tako 图标，打开 Chrome 侧边栏。
3. 选择想要的章节，点击**下载**。
4. 在队列中查看进度。保存完成后，结果显示为**已保存**或**已保存到文件夹**。

Tako 默认通过 Chrome 下载功能保存 CBZ 文件。可以用兼容的漫画阅读器打开 CBZ。

> [!TIP]
> MangaDex 默认关闭。请在**选项 → 站点集成**中启用，接受 Chrome 的网站访问请求，点击**保存更改**，再返回系列页面。

## 选择格式

从侧边栏打开**设置**，或右键点击 Tako 图标并选择**选项**。在**存储与文件**中选择压缩格式，然后点击**保存更改**。

| 格式       | 用途                         |
| ---------- | ---------------------------- |
| **CBZ**    | 在漫画阅读器中阅读章节       |
| **ZIP**    | 将章节图片保存在标准压缩包中 |
| **不打包** | 保存为单独的图片文件         |

还可以附上系列封面和 ComicInfo.xml 元数据，供兼容的阅读器使用。[文件名模板](Template-Macros.zh-CN)可设置文件夹结构和章节命名方式。

## 选择保存文件夹

在**选项 → 存储与文件**中，保留**使用浏览器下载**即可使用 Chrome 的下载位置；也可以选择**使用自定义文件夹（File System Access）**并选取文件夹。点击**保存更改**后，新下载任务会使用该设置。

下载过程中也可以修改默认设置。已加入队列的任务会保留各自的文件夹和指定的文件名，重试或重新开始时也一样。要将章节保存到其他位置，请修改默认设置并创建新任务。

可选设置**文件夹不可用时使用 Chrome 下载**适用于新任务，默认关闭。只有在任务首次尝试写入所选文件夹之前，才可以切换保存位置。

## 管理下载

Tako 每次处理一个章节。下载期间可以继续向队列添加章节。保存期间请保持 Chrome 运行。

- 使用**重试失败章节**再次处理任务中未完成的部分。只保存了部分内容的章节会从头开始。
- 使用**重新开始任务**重新下载该任务中的全部章节。
- 使用**取消下载**停止任务尚未完成的处理。已保存的文件保留在磁盘上，Chrome 已接受的传输会继续在 Chrome 下载中进行。
- 在选项中打开**活动与历史**，查看以往的任务和章节记录。

文件夹权限错误、任务中断或**此前已处理**结果的说明，请参阅[问题排查](Troubleshooting.zh-CN)。
