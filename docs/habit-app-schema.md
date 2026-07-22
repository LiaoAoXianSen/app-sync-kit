# Habit App 同步协议草案

生成日期：2026-07-22  
适用范围：`life-plan-site` PC 习惯中心、`yuanqidaka` Android App、后续其他习惯客户端。  
默认远程路径：`/apps/habit-app/data.json`。  
Worker 原则：Cloudflare Worker 继续保持通用 JSON KV 存储，只负责多 path、ETag、`If-Match`；不放习惯业务合并逻辑。

---

## 1. 目标

统一习惯系统不是让 Web 和 App 长得一样，而是让它们共用同一份习惯数据和规则：

| 端 | 定位 |
|---|---|
| `yuanqidaka` App | 高频移动执行端：打卡、补签、愿望兑换、提醒、快速反馈 |
| `life-plan-site` Web | PC 完整操作端：今日执行、补卡审计、习惯库、钱包账本、分析、迁移/同步控制 |
| `app-sync-kit` | 公共数据协议、normalize、merge、hash、安全验证 |

旧 `life-plan-site` 习惯字段和 `yuanqidaka` Room 表都不是最终标准，它们是迁移/映射来源。最终标准是本协议定义的 `HabitSnapshot`。

---

## 2. 云端文件

建议使用 WebDAV/Worker legacy raw JSON 模式，云端文件内容就是 snapshot 裸数据：

```json
{
  "habits": [],
  "habitGroups": [],
  "habitRecords": [],
  "habitRewards": [],
  "habitRewardRecords": [],
  "habitFineRecords": [],
  "habitLedger": [],
  "habitCurrencies": [],
  "habitMilestones": [],
  "habitMilestoneClaims": [],
  "habitOverdueEvents": [],
  "habitMoodNotes": [],
  "habitTimeTasks": [],
  "deletedItems": []
}
```

默认：

- `appId`: `habit-app`
- `schemaVersion`: `1`
- `remotePath`: `/apps/habit-app/data.json`
- browser/local storage keys:
  - `habitAppData`
  - `habitAppSyncState`
  - `habitAppSyncConfig`

---

## 3. 通用实体规则

所有可同步实体必须有：

```ts
id: string
createdAt?: string
updatedAt?: string
deletedAt?: string | null
```

规则：

1. `id` 必须是稳定字符串。不得使用 Room 自增 `Long` 作为云端 ID。
2. 普通客户端创建新对象时使用 UUID/ULID 或可确定的业务 id。
3. `updatedAt` 是 LWW 合并依据；缺失时退回 `createdAt`；都缺失时视作 `0`。
4. 删除不硬删，写 `deletedAt` 或 `deletedItems` 墓碑。
5. 墓碑胜过旧实体；只有同 id 且 `updatedAt > deletedAt` 才可恢复。
6. adapter normalize 不随机生成 id；缺 id 的实体会被丢弃。迁移器可以在迁移阶段生成 id。

---

## 4. Snapshot 类型

核心类型定义以 `packages/adapter-habit-app/src/index.ts` 为准。概念摘要如下：

### 4.1 Habits

`habits[]` 表示习惯定义。

关键字段：

- `title`：习惯名
- `description`
- `status`: `active | archived`
- `sort`
- `icon`
- `color`
- `groupId`
- `rewardAmount` / `rewardCurrencyId`
- `fineAmount` / `fineCurrencyId`
- `repeatUnit`: `daily | weekly | any`
- `weekdays`: `1..7`，周一到周日
- `reminderTimes`: `HH:mm[]`
- `targetCount`
- `targetRewardAmount`
- `requiredCountPerDay`
- `taskDurationSec`
- `lastCheckAt`：展示缓存，不是账本真相

### 4.2 Habit records

`habitRecords[]` 表示打卡/补签/里程碑/目标奖励等领域记录。

关键字段：

- `habitId`
- `recordTime`
- `recordDate`
- `amount`
- `currencyId`
- `type`: `normal | makeup | exempt | overdue_break | streak_reward | target_reward | manual_reward | reverse | adjust`
- `note`
- `countsAsCompletion`：是否计入当日完成次数；`exempt` 默认为 `false`
- `countsForStreak`：是否延续连续；`exempt` 默认为 `true`，`overdue_break` 默认为 `false`
- `sourceKey`：迁移兜底幂等键

### 4.3 Ledger

`habitLedger[]` 是跨端余额真相。

关键字段：

- `type`: `checkin | makeup | exempt | overdue_break | streak_reward | target_reward | reward_redeem | fine | adjust | reverse`
- `amount`：收入为正，支出/罚款为负
- `currencyId`
- `date`
- `habitId?`
- `rewardId?`
- `sourceId?`
- `note`

原则：

- merge 不创造金钱，只合并已有流水。
- 打卡、兑换、罚款、撤销时由业务端生成 ledger。
- `sourceId` 是防重复发奖关键。

推荐 ledger id：

```text
ledger:checkin:{habitRecordId}:{currencyId}
ledger:makeup:{habitRecordId}:{currencyId}
ledger:streak_reward:{claimId}:{currencyId}
ledger:target_reward:{habitRecordId}:{currencyId}
ledger:reward_redeem:{rewardRecordId}:{currencyId}
ledger:fine:{fineRecordIdOrOverdueEventId}:{currencyId}
ledger:reverse:{reversedLedgerId}:{currencyId}
```

### 4.4 Rewards / wishes

`habitRewards[]` 表示愿望/奖励商品。

关键字段：

- `name`
- `description`
- `cost`
- `currencyId`
- `status`
- `sort`
- `icon`
- `color`
- `stock`：`0` 表示不限库存
- `redeemedCount?`：兼容展示字段，不作为财务真相

`habitRewardRecords[]` 表示兑换记录；支出必须同时写入 `habitLedger` 的 `reward_redeem`。

### 4.5 Fines / overdue

`habitFineRecords[]` 表示罚款记录；负数账务写入 `habitLedger` 的 `fine`。

`habitOverdueEvents[]` 表示漏打/逾期事件，便于 PC 端审计：

- `habitId`
- `dueDate`
- `requiredCount`
- `observedCount`
- `missingCount`
- `fineAmount`
- `fineCurrencyId`
- `status`: `pending | deferred | fined | exempt | made_up`

### 4.6 Milestones

`habitMilestones[]` 表示每个习惯的里程碑定义。  
`habitMilestoneClaims[]` 表示领取记录。

里程碑领取必须幂等。推荐 claim id：

```text
claim:{habitId}:{milestoneId}:{cycleStartDate}:{achievedDays}:{currencyId}
```

对应 ledger 的 `sourceId` 使用 claim id。

### 4.7 Groups / currencies

- 默认分组：`default / 默认`
- 默认币种：`default / 金币`
- default 分组和币种不得被 tombstone 删除。

### 4.8 Local-like extras

`habitMoodNotes[]` 和 `habitTimeTasks[]` 用于覆盖 `yuanqidaka` 现有能力。第一阶段可以不同步或只做保守同步；它们不是 Web 核心功能的阻塞项。

---

## 5. normalize 规则

1. 所有 collection 缺失时补空数组。
2. `habitCurrencies` 至少包含默认金币。
3. `habitGroups` 至少包含默认分组。
4. 数字字段 clamp：
   - reward/fine/target/duration >= 0
   - reward cost >= 1
   - requiredCountPerDay >= 1
5. `weekdays` 只保留 `1..7`，去重并排序。
6. `reminderTimes` 只保留 `HH:mm`。
7. `recordDate` 缺失时从 `recordTime` 前 10 位推导。
8. `deletedItems` 只保留已知 collection。
9. soft-deleted 实体在 merge 后不进入 active collection，但会形成 tombstone。
10. `redeemedCount` 不参与财务计算。

---

## 6. merge 规则

### 6.1 普通实体

适用：`habits`、`habitGroups`、`habitCurrencies`、`habitRewards`、`habitTimeTasks`。

- key: `id`
- 同 id 冲突：`updatedAt` 新者胜
- tombstone 胜过旧实体
- default group/currency 受保护

### 6.2 append-only 记录

适用：`habitRecords`、`habitRewardRecords`、`habitFineRecords`、`habitMoodNotes`。

- 优先 key: `id`
- 迁移兜底 key：业务字段组合
- 同 key 冲突：`updatedAt` 新者胜
- 不在 merge 中新增关联 ledger

### 6.3 ledger

优先 key：

```text
ledger:{type}:{sourceId}:{currencyId}
```

没有 `sourceId` 时退回 `id`，再退回包含 type/habit/reward/date/currency/amount/note 的兜底 key。  
跨端业务必须尽量写 deterministic `sourceId`，否则可能重复计入余额。

### 6.4 milestone claims

逻辑 key：

```text
claim:{habitId}:{milestoneId}:{cycleStartDate}:{achievedDays}:{currencyId}
```

同一 claim 合并为一条，防止重复领取。

### 6.5 overdue events

逻辑 key：

```text
overdue:{habitId}:{dueDate}
```

冲突：

1. `updatedAt` 新者胜。
2. 时间相同/缺失时，终态胜过非终态：`fined/exempt/made_up > deferred > pending`。

---

## 7. 与 yuanqidaka 的映射原则

`yuanqidaka` 现有 Room 表继续作为本地缓存和移动端实现细节，但云端必须使用本协议。

关键原则：

1. 给 Room 核心表增加 `remoteId` / `updatedAt` / `deletedAt`。
2. `habitsId`、`wishId`、`recordId` 等 Long 只做本地主键，不做云端 id。
3. `HabitEntity` -> `Habit`。
4. `HabitRecordEntity normal/makeup` -> `HabitRecord` + `HabitLedgerEntry`。
5. `WishEntity` -> `HabitReward`。
6. `WishRecordEntity` -> `HabitRewardRecord` + `HabitLedgerEntry(type=reward_redeem)`。
7. `FineRecordEntity` -> `HabitFineRecord` + `HabitLedgerEntry(type=fine)`。
8. `StreakMilestoneEntity` -> `HabitMilestone`。
9. `StreakRewardClaimEntity` -> `HabitMilestoneClaim` + `HabitLedgerEntry(type=streak_reward)`。
10. `MoodNote` / `TimeTask` 可后置同步。

---

## 8. 与 life-plan-site 的迁移原则

旧 life habit 数据是迁移来源，不是最终协议。

旧集合：

- `habits`
- `checkins`
- `habitPointLedger`
- `habitRewards`
- `habitCurrencies`

迁移到：

- `habits`
- `habitRecords`
- `habitLedger`
- `habitRewards`
- `habitCurrencies`

短期 Web 可以先保留旧字段并生成 snapshot；长期 `/apps/habit-app/data.json` 成为习惯权威。

---

## 9. 安全验证要求

`verify-habit-sync-safety.mjs` 至少覆盖：

1. 首次同步本地未 dirty 且云端已有数据时只拉云端，不上传种子。
2. tombstone 防止习惯复活。
3. 更新晚于 tombstone 的同 id 实体可以恢复。
4. 本地/云端分别新增记录时合并保留两边。
5. ledger 同 source 不重复计入余额。
6. 里程碑 claim 同逻辑 key 不重复。
7. 兑换与罚款并发新增均保留。
8. overdue 同 habit/date 合并为一条。
9. default 分组/币种不被删除。
10. tombstone 去重后 hash 稳定。

---

## 10. 实施顺序

1. `app-sync-kit`: 文档 + `adapter-habit-app` + verify。
2. `life-plan-site`: 新 PC 习惯中心 Phase 1，先保留旧数据结构。
3. `life-plan-site`: 生成 habit snapshot 预览与迁移检查。
4. `life-plan-site`: 双写旧字段和 `/apps/habit-app/data.json`。
5. `yuanqidaka`: Room 增加 remote 字段与 mapper。
6. `yuanqidaka`: 接 Worker，先 pull 再 push，首同步不覆盖。
7. 双端稳定后，habit snapshot 成为习惯权威。
