# 大转盘远程存储接入步骤

## 目标

把 `D:/project/wheel-app` 从“纯本地存储”升级为“本地优先 + 远程同步”。

## 当前现状

- 当前存储入口是 `D:/project/wheel-app/apps/mobile/src/hooks/usePersistentState.ts`
- 当前数据结构主要来自 `D:/project/wheel-app/packages/wheel-core/src/types.ts`
- 现在缺少稳定双向同步最关键的实体时间字段

## 接入前必须补的模型字段

以下实体建议统一补齐：

- `createdAt`
- `updatedAt`
- `deletedAt` 或 tombstone 策略

优先补到：

- `wheels`
- `wheel.items`
- `wheelTags`
- `wheelLibraryItems`
- `wheelHistory`

## 推荐对接顺序

### Phase 1: 数据模型升级

先在 `wheel-core` 中升级类型与创建/编辑逻辑。

目标：

- 新建数据天然带时间戳
- 编辑时自动更新 `updatedAt`
- 删除不再只是直接丢失痕迹

### Phase 2: 本地存储抽象替换

把 `usePersistentState` 升级为基于 `app-sync-kit` 的 store。

建议新增：

- `useWheelStore`
- `useWheelSync`

这样 UI 层不直接碰同步细节。

### Phase 3: 设置页加入同步入口

大转盘当前已经有设置底部弹层，最适合放同步能力。

最小版本包括：

- 远端地址
- 远端路径
- 自动同步开关
- 手动同步按钮
- 同步状态文案

### Phase 4: 先接 WebDAV，再预留 HTTP API

首版直接复用当前人生规划可用的 Worker/WebDAV 通道。

后续如果上 MySQL：

- 不改前端业务逻辑
- 只新增或切换 `provider-http-api`

## 建议的 UI 表达

大转盘首页仍然保持“一个核心转盘”的 App 风格，不把同步配置堆到首页。

同步只出现在：

- 设置页
- 首次未配置时的轻提示
- 同步失败时的状态反馈

## 验收标准

1. 本地断网也能正常使用
2. 两台设备间能完成上传、拉取、自动同步
3. 同时修改时不会整份覆盖丢数据
4. 首页视觉不被同步功能破坏
