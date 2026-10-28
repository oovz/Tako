# 贡献站点集成

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

> 本页由[英文原文](Site-Integration-Guide)机器翻译而来。

本指南面向添加或维护网站支持的贡献者。如果只想申请新网站支持，可以[提交功能请求](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。

环境配置见[贡献指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)，运行时职责见[架构](Architecture.zh-CN)。站点集成是随扩展打包的 TypeScript 模块。

## 站点集成的职责

站点集成识别受支持的页面，解析系列和章节信息，下载图片，并执行网站所需的图片变换。其定义声明来源、请求策略和设置。

站点细节应保留在集成内部。共享队列和消息契约使用 `siteIntegrationId` 及通用集成上下文。

## 添加网站

### 1. 创建脚手架

```powershell
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

命令会创建源文件和测试数据种子：

| 文件                                                  | 用途                                   |
| ----------------------------------------------------- | -------------------------------------- |
| `src/site-integrations/<id>/definition.json`          | 标识、网址匹配、来源、能力、策略和设置 |
| `src/site-integrations/<id>/background-runtime.ts`    | 系列和章节列表解析                     |
| `src/site-integrations/<id>/offscreen-runtime.ts`     | 章节计划和图片下载                     |
| `src/site-integrations/<id>/contracts/index.ts`       | 站点数据契约                           |
| `tests/fixtures/site-integrations/<id>/contract.json` | 确定性测试数据种子                     |

骨架初始设置为 `shipped: false` 和 `enabledByDefault: false`。实现和测试准备好发布后，再设为 `shipped: true`。如需在独立位置创建骨架，可用 `--out-dir` 指定源文件目录，用 `--fixtures-dir` 指定测试数据目录。

### 2. 声明网站契约

编辑 `definition.json`，参考[定义结构](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)和类似的已有站点集成。

将 `name` 设为网站的原语言显示名称，`englishName` 设为英文名称。`id` 和集成目录使用稳定的标识符；备用域名放在匹配规则中。

定义 Tako 应识别的页面、固定和可选来源、端点用途、凭据、响应类型及限制、请求间隔、重试职责，以及所需的运行时能力。声明范围以集成需要的访问为准。

### 3. 在后台解析系列

按照 [`ServiceWorkerIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)，在 `background-runtime.ts` 中实现 `resolveSeriesData`。

从网址数据、站点 API 或抓取的 HTML 中解析系列标题、元数据、章节 ID、章节网址和可用状态。请求使用 `integrationHttpClient`，返回前验证站点数据。章节处理需要调度上下文时，再添加相应准备逻辑。

### 4. 在离屏文档中解析并下载章节图片

按照 [`OffscreenIntegration`](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)，在 `offscreen-runtime.ts` 中实现 `resolveChapterPlan` 和 `downloadImage`。

使用共享章节计划结构和 `fetchImageWithStallDetection`。将提供的取消信号、速率策略、字节进度回调和活动资源账本传递到请求中。返回每张图片的字节、文件名、MIME 类型和资源租约。遵循已有集成的调度职责，保证每个请求只调度一次。

在分配资源或进行特权操作之前，验证响应大小、图片尺寸、页数和站点提供的网址。图片变换必须预留所需资源，并在成功、失败或取消后释放。

### 5. 为集成编写文档和测试

将保存的 HTML、协议测试向量和受控图片输入放在 `tests/fixtures/site-integrations/<id>/`。生成器检查标准 `contract.json` 的封装格式：`schemaVersion: 1`、集成对应的 `providerId`，以及对象类型的 `data`。在数据旁保留来源说明，便于贡献者区分捕获字段与合成测试数据。

添加有针对性的单元测试，对界面可见的行为添加模拟浏览器测试。检查页面顺序、图片变换后的内容，以及能否成功解码。

集成的 `README.md` 是可选文档。代码、类型、测试数据说明和共享指南之外，还有对贡献者有用的实用信息时，再添加此文件，并围绕这些信息展开。读者操作说明放在[支持的网站](Supported-Sites.zh-CN)和[故障排查](Troubleshooting.zh-CN)。实际站点检查从 `tests/live/` 运行，共享作品网址定义在 `tests/e2e/fixtures/test-domains-constants.ts`。

### 6. 生成并验证

开发期间运行针对性测试及以下检查：

```powershell
pnpm generate:site-integrations
pnpm check:site-integrations
pnpm type-check
pnpm lint
pnpm test:unit
```

解析器和测试样本准备好后，设置 `shipped: true` 并重新生成目录。运行[贡献指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)中适用的集成和浏览器检查，再用 `pnpm build` 构建生产扩展。

实际站点检查按需启用。按照[实际章节验证指南](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#live-chapter-validation)，检查实际保存的章节，并将变换后的页面与网站阅读器进行对比。记录此次运行的作品、章节、日期、保存结果和视觉检查结果。确定性测试样本覆盖保留的协议及失败情况。

## 可选能力

### 一次性页面探针

需要实时页面状态时，声明 `pageProbe: "optional"` 或 `"required"`，并提供 `probe.ts`。使用读取范围受限的只读探针，返回经过验证的普通数据，并在完成后释放资源。默认使用隔离环境；如需主环境，应记录原因。

### 请求头

在 `sessionRefererRules` 中声明必需的 Referer 规则。使用受管理的 ID 范围 `41000`–`41999`，以及已声明的站点域名和来源。规则的作用范围保持为扩展请求。

### 图片变换

声明图片变换能力，并在离屏运行时中实现。复用共享图片传输和资源计数。添加能检测分镜、图块或页面顺序错误的确定性测试样本。

### 站点提供的图片服务器

对于动态选择的图片主机，声明 `originKind: "provider-issued"`，并在站点提供网址的位置验证网址。固定端点来源放入 `requiredOrigins`，可选主机模式放入 `optionalOrigins`。生成器会为默认关闭但随扩展打包的站点集成处理可选授权。

### 本地化设置

在 `customSettings` 中声明有类型的设置。标签、描述和选项标签必须存在于全部五个语言目录中：`en`、`ja`、`zh_CN`、`zh_TW` 和 `ko`。生成器会检查必需的键是否齐全。

## 共享请求安全

站点请求使用 `integrationHttpClient` 和共享端点策略。这些边界执行已声明的来源和凭据策略、HTTPS 和公共主机验证、重定向策略、响应大小限制以及取消。图片传输还会验证 MIME 类型和字节限制。

将可执行的集成代码随扩展打包，把远程响应作为数据解析。诊断信息包含脱敏后的技术细节；凭据和原始响应保留在请求边界内。

相关页面：[架构](Architecture.zh-CN)、[权限说明](Permissions.zh-CN)和[支持的网站](Supported-Sites.zh-CN)。
