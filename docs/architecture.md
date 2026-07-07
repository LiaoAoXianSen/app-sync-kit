# 通用云同步底座架构方案

## 目标

为多个前端项目提供一套可复用的云同步能力，不再让每个项目各自实现一套同步逻辑。

首批服务对象：

- `D:/project/life-plan-site`
- `D:/project/wheel-app`

未来预留：

- 其他网页工具
- 小程序版本
- App 端更多模块
- Java / Node 后端服务
- MySQL 持久化

## 最终架构

采用五层结构：

1. 业务数据层
2. 同步核心层 `sync-core`
3. 远端 provider 层
4. 业务 adapter 层
5. 浏览器分发层 `@app-sync-kit/browser`

### 1. 业务数据层

业务项目维护自己的数据模型，例如：

- 人生规划：`records`、`todos`、`habits`、`goals`
- 大转盘：`wheels`、`wheelTags`、`wheelLibraryItems`、`wheelHistory`

这一层只关心数据本身，不关心云端是什么。

### 2. 同步核心层 `sync-core`

负责统一处理：

- 本地加载与保存
- 脏数据标记 `dirty`
- 数据 hash
- 手动同步
- 自动同步调度
- 拉取 / 上传
- 冲突检测
- 合并策略分发
- 同步状态记录

这一层不关心远端是 WebDAV、HTTP API、Supabase 还是未来的 MySQL 后端服务。

### 3. provider 层

provider 只负责“怎么跟远端说话”。

第一批预留两个 provider：

- `provider-webdav`
- `provider-http-api`

说明：

- `provider-webdav`
  直接复用人生规划现有的 Worker/WebDAV 同步通道
- `provider-http-api`
  作为未来后端服务入口，由 Java / Node 服务再去连 MySQL

WebDAV provider 必须同时支持两种远端文件格式：

- `wrapped-document`：正式的 `RemoteDocument { appId, schemaVersion, updatedAt, data }`
- `legacy-raw-data`：现有静态项目直接上传的业务 JSON

`legacy-raw-data` 用于兼容已经部署的 Worker/WebDAV 文件，例如人生规划和低风险实验项目的原始 JSON。

结论：

前端永远不直接兼容 MySQL。
前端兼容的是“基于 MySQL 的 HTTP 服务”。

### 4. adapter 层

每个业务项目提供自己的 adapter，用来告诉同步核心：

- 默认数据结构
- 数据归一化方式
- 哪些集合需要参与合并
- 主键怎么取
- 更新时间怎么取
- 删除记录怎么表示
- 默认远端路径是什么

### 5. 浏览器分发层

静态项目不一定有构建系统，所以 `@app-sync-kit/browser` 提供聚合入口和单文件浏览器 bundle。

它负责组合：

- `sync-core`
- `provider-webdav`
- 已发布 adapter

并提供 `createBrowserWebdavSyncManager` 这种浏览器友好的入口。该入口默认使用 `legacy-raw-data`，避免接入现有 WebDAV JSON 时改变远端文件结构。

## 对 MySQL 的预留方式

系统兼容的不是“数据库类型”，而是“provider 接口”。

也就是说：

- 现在可以接 WebDAV
- 未来可以接 HTTP API
- 后端如果落 MySQL，也只是 HTTP API provider 的后端实现变化

这样以后从 WebDAV 切到 MySQL，不需要改业务层和同步核心层。

## 通用 provider 接口

建议统一为：

```ts
export interface RemoteDocument<TData> {
  appId: string;
  schemaVersion: number;
  updatedAt: string;
  data: TData;
}

export interface SyncProvider<TData, TConfig = unknown> {
  pull(config: TConfig): Promise<RemoteDocument<TData> | null>;
  push(config: TConfig, doc: RemoteDocument<TData>): Promise<void>;
  healthCheck?(config: TConfig): Promise<void>;
}
```

## 通用 adapter 接口

```ts
export interface SyncAdapter<TData> {
  appId: string;
  schemaVersion: number;
  createDefaultData(): TData;
  normalizeData(input: unknown): TData;
  getLocalStorageKey(): string;
  getRemotePath(): string;
  merge(localData: TData, remoteData: TData): TData;
  getHash(data: TData): string;
}
```

## 大转盘侧必须补的字段

为了支持真正可靠的双向同步，大转盘未来要逐步补齐：

- `createdAt`
- `updatedAt`
- `deletedAt` 或 tombstone 删除记录

建议补到：

- `wheels`
- `wheel.items`
- `wheelTags`
- `wheelLibraryItems`
- `wheelHistory`

否则冲突合并时很难稳定判断哪条是更新版本。

## 远端文件组织建议

不要把多个应用塞进同一个 JSON 根对象里。

建议按应用隔离：

- `/apps/life-plan/data.json`
- `/apps/wheel-app/data.json`

如果以后有多用户，再扩展为：

- `/apps/life-plan/{userId}/data.json`
- `/apps/wheel-app/{userId}/data.json`

## 生命周期建议

统一同步流程：

1. 本地修改
2. 标记 `dirty`
3. 延迟自动同步
4. 先拉云端
5. 比较本地 hash、远端 hash、上次同步 hash
6. 无冲突则上传或拉取
7. 有冲突则走 adapter 的 merge
8. 回写本地
9. 必要时重新上传
10. 更新 `syncState`

## 当前结论

最终方案不是“给大转盘做一次云端存储”，而是：

做一个独立的、可插拔的、框架无关的通用同步底座。

先支持 WebDAV，结构上预留 HTTP API，因此未来可以平滑切到 Java / Node + MySQL。
