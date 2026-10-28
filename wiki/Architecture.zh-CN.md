# 架构

[English](Architecture) · [日本語](Architecture.ja) · [简体中文](Architecture.zh-CN) · [繁體中文](Architecture.zh-TW) · [한국어](Architecture.ko)

> 本页由[英文原文](Architecture)机器翻译而来。

Tako 是基于 WXT 的 Manifest V3 扩展，适用于 Chrome 150 或更新版本。本页帮助贡献者找到需要修改的代码。下载帮助见[快速入门](Quick-Start.zh-CN)和[问题排查](Troubleshooting.zh-CN)。

## 扩展组成

| 组件                | 职责                                               |
| ------------------- | -------------------------------------------------- |
| 侧边栏与选项        | 章节选择、下载进度、历史和设置                     |
| 后台 Service Worker | 队列管理、状态保存、权限和 Chrome 下载             |
| 离屏文档            | 获取和处理章节图片、创建压缩包、保存到自定义文件夹 |
| 站点集成            | 识别网站、解析系列信息和章节列表、处理图片         |

## 源码索引

| 修改内容       | 入口                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 侧边栏与选项   | [`entrypoints/sidepanel/`](https://github.com/oovz/Tako/tree/main/entrypoints/sidepanel), [`entrypoints/options/`](https://github.com/oovz/Tako/tree/main/entrypoints/options) |
| 后台任务       | [`entrypoints/background/`](https://github.com/oovz/Tako/tree/main/entrypoints/background)                                                                                     |
| 图片处理和打包 | [`entrypoints/offscreen/`](https://github.com/oovz/Tako/tree/main/entrypoints/offscreen)                                                                                       |
| 网站支持       | [`src/site-integrations/`](https://github.com/oovz/Tako/tree/main/src/site-integrations)                                                                                       |
| 领域逻辑       | [`src/domain/`](https://github.com/oovz/Tako/tree/main/src/domain)                                                                                                             |
| 设置和历史存储 | [`src/storage/`](https://github.com/oovz/Tako/tree/main/src/storage)                                                                                                           |
| 共享运行时服务 | [`src/runtime/`](https://github.com/oovz/Tako/tree/main/src/runtime)                                                                                                           |
| 站点接口       | [`src/types/site-integrations.ts`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)                                                                      |

环境配置和测试见[贡献指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)。添加网站支持请参阅[站点集成指南](Site-Integration-Guide.zh-CN)。

## 参考资料

- [Chrome 扩展 Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Chrome 侧边栏 API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Chrome 离屏 API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome 下载 API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
