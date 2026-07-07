# App Sync Kit

一个独立的通用云同步底座项目，用来服务多个前端应用的数据同步。

当前目标：

- 先承接 `D:/project/life-plan-site` 已有的云同步能力
- 再给 `D:/project/wheel-app` 接入同一套同步底座
- 架构上预留 `WebDAV`、`HTTP API`、未来基于 `MySQL` 的后端服务能力

## 设计原则

- 业务数据和同步逻辑分离
- 不让前端直接耦合某种数据库
- 通过 provider 适配不同远端数据源
- 让每个业务只写自己的 adapter

## 目录规划

- `docs/`
  存放架构方案、对接方式、阶段计划
- `packages/sync-core/`
  通用同步引擎
- `packages/provider-webdav/`
  现阶段优先落地的 WebDAV provider
- `packages/provider-http-api/`
  为未来 Java / Node / MySQL 后端预留的 HTTP provider
- `packages/browser/`
  面向静态浏览器项目的聚合入口，可生成单文件 ESM / global bundle
- `packages/adapter-life-plan/`
  人生规划业务适配器
- `packages/adapter-wheel-app/`
  大转盘业务适配器
- `packages/adapter-pantry-chef/`
  厨房库存实验项目适配器

## 预期接入方式

每个业务项目接入时只做两件事：

1. 选择一个 provider
2. 提供自己的 adapter

之后就能获得统一的：

- 本地缓存
- dirty 标记
- 手动同步
- 自动同步
- 冲突合并
- 同步状态

## 当前阶段

现在已经完成第一版代码骨架：

- `sync-core` 已提供通用 `SyncManager`、本地存储接口、hash 工具与类型定义
- `provider-webdav` 已提供 WebDAV 读写与健康检查骨架
- `provider-http-api` 已定义未来对接后端 API 的统一入口
- `adapter-life-plan` 已把当前人生规划的主要合并规则抽成适配器
- `adapter-wheel-app` 已建立大转盘的同步适配器骨架
- `adapter-pantry-chef` 已限定只同步用户库存、常备调料、购物清单和偏好
- `browser` 已提供 `createBrowserWebdavSyncManager`，默认使用 `legacy-raw-data` 兼容现有 WebDAV JSON

下一阶段建议：

1. 先让 `life-plan-site` 接回 `app-sync-kit`，验证不退化
2. 再给 `wheel-app` 补齐同步字段并正式接入远程存储
3. 最后补一套 HTTP API provider 的服务端契约

## 浏览器构建

静态项目可以先生成浏览器 bundle：

```bash
npm run build
```

生成文件：

- `packages/browser/dist/app-sync-kit.browser.js`
- `packages/browser/dist/app-sync-kit.browser.global.js`

最小接入示例：

```js
import {
  adapters,
  createBrowserWebdavSyncManager
} from './vendor/app-sync-kit.browser.js';

const syncManager = createBrowserWebdavSyncManager({
  adapter: adapters.pantryChef,
  endpoint: syncUrl,
  remotePath: '/apps/pantry-chef/data.json'
});
```
