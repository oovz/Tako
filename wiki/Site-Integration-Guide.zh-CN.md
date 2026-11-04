# 添加站点集成

[English](Site-Integration-Guide) · [日本語](Site-Integration-Guide.ja) · [简体中文](Site-Integration-Guide.zh-CN) · [繁體中文](Site-Integration-Guide.zh-TW) · [한국어](Site-Integration-Guide.ko)

不编写代码也可以[申请支持新网站](https://github.com/oovz/Tako/issues/new?template=feature_request.md)。开发环境的准备步骤见[贡献指南（英文）](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md)。

## 创建集成

```sh
pnpm new:site-integration <id> --name "Native Site Name" --english-name "English Site Name"
```

`--name` 填写网站的原语言名称。英语网站的 `--english-name` 填写相同的名称。其他网站填写运营方在官网、标志或官方社交媒体账号上使用的英文名称或拉丁字母品牌名。如果两者都没有，使用主域名中紧邻公共后缀之前的部分，例如 `www.example.co.jp` 填写 `example`。

脚手架会在 `src/site-integrations/<id>/` 创建源文件，在 `tests/fixtures/site-integrations/<id>/` 创建测试数据。

在 `definition.json` 声明支持的 URL 和所需访问权限。在 `background-runtime.ts` 实现作品信息和章节列表的加载，在 `offscreen-runtime.ts` 实现章节图片的加载。可参考[定义结构](https://github.com/oovz/Tako/blob/main/src/site-integrations/definition.schema.json)、[运行时接口](https://github.com/oovz/Tako/blob/main/src/types/site-integrations.ts)以及相似的现有集成。

使用 `integrationHttpClient` 发送请求，使用 `fetchImageWithStallDetection` 获取图片。传递取消信号、速率设置、字节进度和资源管理参数。每个请求只调度一次。

在分配资源或进行特权操作之前，验证响应大小、图片尺寸、页数和站点提供的网址。图片变换必须预留所需资源，并在成功、失败或取消后释放。

只申请必要的网站访问权限。可执行代码须随扩展打包，不要执行网站响应中的代码，也不要把凭据写入日志。

## 添加测试

将 HTML、API 和图片测试数据放在生成的 `contract.json` 旁边。注明来源，移除账户信息、Cookie 和令牌。

生成器会检查 `contract.json` 的外层结构：`schemaVersion: 1`、集成对应的 `providerId`，以及对象类型的 `data`。

测试元数据、章节顺序、图片转换和失败处理。界面行为使用模拟浏览器测试验证；除了确认压缩包存在，还要检查保存的图片。能够访问真实网站时，添加实站测试。

```sh
pnpm generate:site-integrations
pnpm lint
pnpm type-check
pnpm test:unit
```

按[贡献指南的测试说明](https://github.com/oovz/Tako/blob/main/CONTRIBUTING.md#testing)运行相关的集成测试和浏览器测试，最后运行 `pnpm build`。

## 完成提交

脚手架默认设置为 `shipped: false` 和 `enabledByDefault: false`。实现和测试准备好后，再改为 `shipped: true` 并重新生成集成清单。

在 `customSettings` 中声明带类型的设置。请在全部五个语言目录中补齐所引用的标签、描述和选项标签：`en`、`ja`、`zh_CN`、`zh_TW` 和 `ko`。

更新[支持的网站](Supported-Sites.zh-CN)和[问题排查](Troubleshooting.zh-CN)，说明会影响下载的访问条件。

## 可选能力

### 一次性页面探针

需要实时页面状态时，声明 `pageProbe: "optional"` 或 `"required"`，并提供 `probe.ts`。使用读取范围受限的只读探针，返回经过验证的普通数据，并在完成后释放资源。默认使用隔离环境。

### 请求头

在 `sessionRefererRules` 中声明必需的 Referer 规则。使用受管理的 ID 范围 `41000`–`41999`，以及已声明的站点域名和来源。规则只作用于扩展发出的请求。

### 图片变换

在定义文件中声明图片变换，并在离屏运行时实现。测试分镜、图块和页面顺序。封面需要不同的图片处理时，实现 `cover.downloadImage`。

### 站点提供的图片服务器

对于动态选择的图片主机，声明 `originKind: "provider-issued"`，并在站点提供网址的位置验证网址。固定端点来源放入 `requiredOrigins`，可选主机模式放入 `optionalOrigins`。
