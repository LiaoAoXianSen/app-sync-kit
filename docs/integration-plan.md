# 第一阶段对接计划

## Phase 1

先把人生规划现有同步逻辑抽象为公共能力，不直接复制旧代码。

### 1. 抽取 `sync-core`

优先从 `D:/project/life-plan-site/app.js` 中提炼这些能力：

- `syncConfig`
- `syncState`
- `webdavRequest`
- `fetchRemoteData`
- `mergeCloudData`
- `runCloudSync`
- `startPeriodicCloudSync`

### 2. 做 WebDAV Provider

先让当前可用的 Worker/WebDAV 方案继续工作。

这样能保证：

- 不换后端
- 成本最低
- 回归最快

### 3. 做 Life Plan Adapter

把人生规划的数据结构、合并集合、主键规则、归一化逻辑封成 adapter。

### 4. 让人生规划先接回公共同步底座

这是第一阶段最重要的回归验证对象。

目标：

- 现有云同步不退化
- 设置页还能工作
- 自动同步还能工作
- 合并逻辑行为保持一致

## Phase 2

接入大转盘。

### 1. 升级大转盘数据模型

补充：

- `createdAt`
- `updatedAt`
- 删除记录策略

### 2. 做 Wheel Adapter

封装：

- 默认数据结构
- 本地存储 key
- 远端路径
- 合并规则

### 3. 在 `wheel-app` 中替换本地存储钩子

把当前的 `usePersistentState` 升级为基于同步底座的 store。

### 4. 提供同步 UI

最小版本先有：

- 同步配置
- 手动同步
- 同步状态
- 自动同步开关

## Phase 3

补 `provider-http-api`。

此阶段不要求立刻上 MySQL，只要求把接口形态留好。

未来只要后端服务落地：

- Java + MySQL
- Node + MySQL

前端只切 provider 配置，不重写同步主流程。
