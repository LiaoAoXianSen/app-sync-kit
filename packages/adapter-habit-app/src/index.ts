import { createHash, type SyncAdapter } from '@app-sync-kit/sync-core';

export type HabitStatus = 'active' | 'archived';
export type HabitRepeatUnit = 'daily' | 'weekly' | 'any';
export type HabitRecordType =
  | 'normal'
  | 'makeup'
  | 'exempt'
  | 'overdue_break'
  | 'streak_reward'
  | 'target_reward'
  | 'manual_reward'
  | 'reverse'
  | 'adjust';

export type HabitLedgerType =
  | 'checkin'
  | 'makeup'
  | 'exempt'
  | 'overdue_break'
  | 'streak_reward'
  | 'target_reward'
  | 'reward_redeem'
  | 'fine'
  | 'adjust'
  | 'reverse';

export type HabitOverdueStatus = 'pending' | 'deferred' | 'fined' | 'exempt' | 'made_up';

export type HabitCollectionName =
  | 'habits'
  | 'habitGroups'
  | 'habitRecords'
  | 'habitRewards'
  | 'habitRewardRecords'
  | 'habitFineRecords'
  | 'habitLedger'
  | 'habitCurrencies'
  | 'habitMilestones'
  | 'habitMilestoneClaims'
  | 'habitOverdueEvents'
  | 'habitMoodNotes'
  | 'habitTimeTasks';

export interface HabitEntityBase {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface HabitGroup extends HabitEntityBase {
  name: string;
  sort: number;
  color?: string;
  icon?: string;
}

export interface HabitCurrency extends HabitEntityBase {
  id: string;
  name: string;
  icon: string;
  sort: number;
}

export interface Habit extends HabitEntityBase {
  title: string;
  description: string;
  status: HabitStatus;
  sort: number;
  icon: string;
  color: string;
  groupId: string;
  rewardAmount: number;
  rewardCurrencyId: string;
  fineAmount: number;
  fineCurrencyId: string;
  repeatUnit: HabitRepeatUnit;
  weekdays: number[];
  reminderTimes: string[];
  targetCount: number;
  targetRewardAmount: number;
  requiredCountPerDay: number;
  taskDurationSec: number;
  lastCheckAt?: string;
}

export interface HabitRecord extends HabitEntityBase {
  habitId: string;
  recordTime: string;
  recordDate: string;
  amount: number;
  currencyId: string;
  type: HabitRecordType;
  note: string;
  countsAsCompletion: boolean;
  countsForStreak: boolean;
  sourceKey?: string;
}

export interface HabitReward extends HabitEntityBase {
  name: string;
  description: string;
  cost: number;
  currencyId: string;
  status: HabitStatus;
  sort: number;
  icon: string;
  color: string;
  stock: number;
  redeemedCount?: number;
}

export interface HabitRewardRecord extends HabitEntityBase {
  rewardId: string;
  redeemedAt: string;
  amount: number;
  currencyId: string;
  note: string;
  ledgerId?: string;
  sourceKey?: string;
}

export interface HabitFineRecord extends HabitEntityBase {
  habitId: string;
  finedAt: string;
  amount: number;
  currencyId: string;
  reason: string;
  overdueEventId?: string;
  ledgerId?: string;
  sourceKey?: string;
}

export interface HabitLedgerEntry extends HabitEntityBase {
  type: HabitLedgerType;
  amount: number;
  currencyId: string;
  date: string;
  habitId?: string;
  rewardId?: string;
  sourceId?: string;
  note: string;
}

export interface HabitMilestone extends HabitEntityBase {
  habitId: string;
  targetDays: number;
  rewardAmount: number;
  currencyId: string;
  sort: number;
  label: string;
}

export interface HabitMilestoneClaim extends HabitEntityBase {
  habitId: string;
  milestoneId: string;
  cycleStartDate: string;
  achievedDays: number;
  rewardAmount: number;
  currencyId: string;
  claimedAt: string;
  habitRecordId?: string;
  ledgerId?: string;
}

export interface HabitOverdueEvent extends HabitEntityBase {
  habitId: string;
  dueDate: string;
  requiredCount: number;
  observedCount: number;
  missingCount: number;
  fineAmount: number;
  fineCurrencyId: string;
  status: HabitOverdueStatus;
  handledAt?: string;
  exemptionWeekStart?: string;
  fineRecordId?: string;
}

export interface HabitMoodNote extends HabitEntityBase {
  habitId?: string;
  rewardId?: string;
  moodId: number;
  content: string;
  notedAt: string;
}

export interface HabitTimeTask extends HabitEntityBase {
  habitId: string;
  title: string;
  durationSec: number;
  leftSec: number;
  status: 'idle' | 'running' | 'paused' | 'done';
}

export interface HabitDeletedItem {
  collection: HabitCollectionName;
  id: string;
  deletedAt: string;
  parentId?: string;
}

export interface HabitSnapshot {
  habits: Habit[];
  habitGroups: HabitGroup[];
  habitRecords: HabitRecord[];
  habitRewards: HabitReward[];
  habitRewardRecords: HabitRewardRecord[];
  habitFineRecords: HabitFineRecord[];
  habitLedger: HabitLedgerEntry[];
  habitCurrencies: HabitCurrency[];
  habitMilestones: HabitMilestone[];
  habitMilestoneClaims: HabitMilestoneClaim[];
  habitOverdueEvents: HabitOverdueEvent[];
  habitMoodNotes: HabitMoodNote[];
  habitTimeTasks: HabitTimeTask[];
  deletedItems: HabitDeletedItem[];
}

const DEFAULT_GROUP_ID = 'default';
const DEFAULT_CURRENCY_ID = 'default';
const DEFAULT_TIMESTAMP = '1970-01-01T00:00:00.000Z';
const COLLECTIONS = new Set<HabitCollectionName>([
  'habits',
  'habitGroups',
  'habitRecords',
  'habitRewards',
  'habitRewardRecords',
  'habitFineRecords',
  'habitLedger',
  'habitCurrencies',
  'habitMilestones',
  'habitMilestoneClaims',
  'habitOverdueEvents',
  'habitMoodNotes',
  'habitTimeTasks'
]);
const TERMINAL_OVERDUE = new Set<HabitOverdueStatus>(['fined', 'exempt', 'made_up']);

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function intMin(value: unknown, min: number, fallback = min): number {
  return Math.max(min, Math.trunc(numberValue(value, fallback)));
}

function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeTimestamp(value: string | undefined | null): number {
  const time = new Date(String(value ?? '')).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getEntityTime(item?: HabitEntityBase): number {
  if (!item) return 0;
  return normalizeTimestamp(item.updatedAt ?? item.createdAt ?? item.deletedAt);
}

function getDeletedKey(collection: string, id: string, parentId = ''): string {
  return parentId ? `${collection}:${parentId}:${id}` : `${collection}:${id}`;
}

function idOf(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  return text((input as { id?: unknown }).id);
}

function baseOf<T extends HabitEntityBase>(input: unknown, rest: Omit<T, keyof HabitEntityBase>): T | null {
  const id = idOf(input);
  if (!id) return null;
  const source = input as Partial<HabitEntityBase>;
  return {
    id,
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt) || timestamp(source.createdAt),
    deletedAt: timestamp(source.deletedAt) || undefined,
    ...rest
  } as T;
}

function normalizeStatus(value: unknown): HabitStatus {
  return value === 'archived' ? 'archived' : 'active';
}

function normalizeRepeatUnit(value: unknown): HabitRepeatUnit {
  return value === 'weekly' || value === 'any' ? value : 'daily';
}

function normalizeRecordType(value: unknown): HabitRecordType {
  const allowed: HabitRecordType[] = ['normal', 'makeup', 'exempt', 'overdue_break', 'streak_reward', 'target_reward', 'manual_reward', 'reverse', 'adjust'];
  return allowed.includes(value as HabitRecordType) ? value as HabitRecordType : 'normal';
}

function normalizeLedgerType(value: unknown): HabitLedgerType {
  const allowed: HabitLedgerType[] = ['checkin', 'makeup', 'exempt', 'overdue_break', 'streak_reward', 'target_reward', 'reward_redeem', 'fine', 'adjust', 'reverse'];
  return allowed.includes(value as HabitLedgerType) ? value as HabitLedgerType : 'adjust';
}

function normalizeOverdueStatus(value: unknown): HabitOverdueStatus {
  const allowed: HabitOverdueStatus[] = ['pending', 'deferred', 'fined', 'exempt', 'made_up'];
  return allowed.includes(value as HabitOverdueStatus) ? value as HabitOverdueStatus : 'pending';
}

function normalizeWeekdays(value: unknown): number[] {
  const set = new Set<number>();
  if (Array.isArray(value)) {
    value.forEach((entry) => {
      const day = Math.trunc(numberValue(entry, 0));
      if (day >= 1 && day <= 7) set.add(day);
    });
  }
  return Array.from(set).sort((a, b) => a - b);
}

function normalizeReminderTimes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => text(entry)).filter((entry) => /^\d{2}:\d{2}$/.test(entry))));
}

function normalizeGroup(input: unknown): HabitGroup | null {
  const source = (input || {}) as Partial<HabitGroup>;
  return baseOf<HabitGroup>(input, {
    name: text(source.name, '默认'),
    sort: intMin(source.sort, 0, 0),
    color: text(source.color) || undefined,
    icon: text(source.icon) || undefined
  });
}

function normalizeCurrency(input: unknown): HabitCurrency | null {
  const source = (input || {}) as Partial<HabitCurrency>;
  return baseOf<HabitCurrency>(input, {
    name: text(source.name, source.id === DEFAULT_CURRENCY_ID ? '金币' : '未命名币种'),
    icon: text(source.icon, source.id === DEFAULT_CURRENCY_ID ? '🪙' : ''),
    sort: intMin(source.sort, 0, 0)
  });
}

function normalizeHabit(input: unknown): Habit | null {
  const source = (input || {}) as Partial<Habit>;
  return baseOf<Habit>(input, {
    title: text(source.title, '未命名习惯'),
    description: text(source.description),
    status: normalizeStatus(source.status),
    sort: intMin(source.sort, 0, 0),
    icon: text(source.icon, '✅'),
    color: text(source.color, '#6EA6E4'),
    groupId: text(source.groupId, DEFAULT_GROUP_ID),
    rewardAmount: intMin(source.rewardAmount, 0, 0),
    rewardCurrencyId: text(source.rewardCurrencyId, DEFAULT_CURRENCY_ID),
    fineAmount: intMin(source.fineAmount, 0, 0),
    fineCurrencyId: text(source.fineCurrencyId, DEFAULT_CURRENCY_ID),
    repeatUnit: normalizeRepeatUnit(source.repeatUnit),
    weekdays: normalizeWeekdays(source.weekdays),
    reminderTimes: normalizeReminderTimes(source.reminderTimes),
    targetCount: intMin(source.targetCount, 0, 0),
    targetRewardAmount: intMin(source.targetRewardAmount, 0, 0),
    requiredCountPerDay: intMin(source.requiredCountPerDay, 1, 1),
    taskDurationSec: intMin(source.taskDurationSec, 0, 0),
    lastCheckAt: timestamp(source.lastCheckAt)
  });
}

function getRecordDefaultFlags(type: HabitRecordType): Pick<HabitRecord, 'countsAsCompletion' | 'countsForStreak'> {
  if (type === 'exempt') return { countsAsCompletion: false, countsForStreak: true };
  if (type === 'overdue_break') return { countsAsCompletion: false, countsForStreak: false };
  if (type === 'normal' || type === 'makeup') return { countsAsCompletion: true, countsForStreak: true };
  return { countsAsCompletion: false, countsForStreak: false };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeHabitRecord(input: unknown): HabitRecord | null {
  const source = (input || {}) as Partial<HabitRecord>;
  const recordTime = text(source.recordTime);
  const type = normalizeRecordType(source.type);
  const flags = getRecordDefaultFlags(type);
  return baseOf<HabitRecord>(input, {
    habitId: text(source.habitId),
    recordTime,
    recordDate: text(source.recordDate, recordTime.slice(0, 10)),
    amount: intMin(source.amount, 0, 0),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    type,
    note: text(source.note),
    countsAsCompletion: normalizeBoolean(source.countsAsCompletion, flags.countsAsCompletion),
    countsForStreak: normalizeBoolean(source.countsForStreak, flags.countsForStreak),
    sourceKey: text(source.sourceKey) || undefined
  });
}

function normalizeReward(input: unknown): HabitReward | null {
  const source = (input || {}) as Partial<HabitReward>;
  return baseOf<HabitReward>(input, {
    name: text(source.name, '未命名心愿'),
    description: text(source.description),
    cost: intMin(source.cost, 1, 1),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    status: normalizeStatus(source.status),
    sort: intMin(source.sort, 0, 0),
    icon: text(source.icon, '🎁'),
    color: text(source.color, '#6EA6E4'),
    stock: intMin(source.stock, 0, 0),
    redeemedCount: source.redeemedCount === undefined ? undefined : intMin(source.redeemedCount, 0, 0)
  });
}

function normalizeRewardRecord(input: unknown): HabitRewardRecord | null {
  const source = (input || {}) as Partial<HabitRewardRecord>;
  return baseOf<HabitRewardRecord>(input, {
    rewardId: text(source.rewardId),
    redeemedAt: text(source.redeemedAt),
    amount: intMin(source.amount, 0, 0),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    note: text(source.note),
    ledgerId: text(source.ledgerId) || undefined,
    sourceKey: text(source.sourceKey) || undefined
  });
}

function normalizeFineRecord(input: unknown): HabitFineRecord | null {
  const source = (input || {}) as Partial<HabitFineRecord>;
  return baseOf<HabitFineRecord>(input, {
    habitId: text(source.habitId),
    finedAt: text(source.finedAt),
    amount: intMin(source.amount, 0, 0),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    reason: text(source.reason),
    overdueEventId: text(source.overdueEventId) || undefined,
    ledgerId: text(source.ledgerId) || undefined,
    sourceKey: text(source.sourceKey) || undefined
  });
}

function normalizeLedger(input: unknown): HabitLedgerEntry | null {
  const source = (input || {}) as Partial<HabitLedgerEntry>;
  return baseOf<HabitLedgerEntry>(input, {
    type: normalizeLedgerType(source.type),
    amount: Math.trunc(numberValue(source.amount, 0)),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    date: text(source.date),
    habitId: text(source.habitId) || undefined,
    rewardId: text(source.rewardId) || undefined,
    sourceId: text(source.sourceId) || undefined,
    note: text(source.note)
  });
}

function normalizeMilestone(input: unknown): HabitMilestone | null {
  const source = (input || {}) as Partial<HabitMilestone>;
  return baseOf<HabitMilestone>(input, {
    habitId: text(source.habitId),
    targetDays: intMin(source.targetDays, 1, 1),
    rewardAmount: intMin(source.rewardAmount, 0, 0),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    sort: intMin(source.sort, 0, 0),
    label: text(source.label)
  });
}

function normalizeMilestoneClaim(input: unknown): HabitMilestoneClaim | null {
  const source = (input || {}) as Partial<HabitMilestoneClaim>;
  return baseOf<HabitMilestoneClaim>(input, {
    habitId: text(source.habitId),
    milestoneId: text(source.milestoneId),
    cycleStartDate: text(source.cycleStartDate),
    achievedDays: intMin(source.achievedDays, 1, 1),
    rewardAmount: intMin(source.rewardAmount, 0, 0),
    currencyId: text(source.currencyId, DEFAULT_CURRENCY_ID),
    claimedAt: text(source.claimedAt),
    habitRecordId: text(source.habitRecordId) || undefined,
    ledgerId: text(source.ledgerId) || undefined
  });
}

function normalizeOverdue(input: unknown): HabitOverdueEvent | null {
  const source = (input || {}) as Partial<HabitOverdueEvent>;
  return baseOf<HabitOverdueEvent>(input, {
    habitId: text(source.habitId),
    dueDate: text(source.dueDate),
    requiredCount: intMin(source.requiredCount, 1, 1),
    observedCount: intMin(source.observedCount, 0, 0),
    missingCount: intMin(source.missingCount, 0, 0),
    fineAmount: intMin(source.fineAmount, 0, 0),
    fineCurrencyId: text(source.fineCurrencyId, DEFAULT_CURRENCY_ID),
    status: normalizeOverdueStatus(source.status),
    handledAt: timestamp(source.handledAt),
    exemptionWeekStart: text(source.exemptionWeekStart) || undefined,
    fineRecordId: text(source.fineRecordId) || undefined
  });
}

function normalizeMoodNote(input: unknown): HabitMoodNote | null {
  const source = (input || {}) as Partial<HabitMoodNote>;
  return baseOf<HabitMoodNote>(input, {
    habitId: text(source.habitId) || undefined,
    rewardId: text(source.rewardId) || undefined,
    moodId: intMin(source.moodId, 0, 0),
    content: text(source.content),
    notedAt: text(source.notedAt)
  });
}

function normalizeTimeTask(input: unknown): HabitTimeTask | null {
  const source = (input || {}) as Partial<HabitTimeTask>;
  const status = ['idle', 'running', 'paused', 'done'].includes(String(source.status)) ? source.status as HabitTimeTask['status'] : 'idle';
  return baseOf<HabitTimeTask>(input, {
    habitId: text(source.habitId),
    title: text(source.title, '未命名计时'),
    durationSec: intMin(source.durationSec, 0, 0),
    leftSec: intMin(source.leftSec, 0, 0),
    status
  });
}

function normalizeDeletedItem(input: unknown): HabitDeletedItem | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Partial<HabitDeletedItem>;
  const collection = source.collection as HabitCollectionName;
  if (!COLLECTIONS.has(collection)) return null;
  const id = text(source.id);
  const deletedAt = text(source.deletedAt);
  if (!id || !deletedAt) return null;
  return {
    collection,
    id,
    deletedAt,
    parentId: text(source.parentId) || undefined
  };
}

function normalizeArray<T>(value: unknown, mapper: (input: unknown) => T | null): T[] {
  return Array.isArray(value) ? value.map(mapper).filter((item): item is T => !!item) : [];
}

function ensureDefaultGroup(groups: HabitGroup[]): HabitGroup[] {
  if (groups.some((group) => group.id === DEFAULT_GROUP_ID && !group.deletedAt)) return groups;
  return [{ id: DEFAULT_GROUP_ID, name: '默认', sort: 0, createdAt: DEFAULT_TIMESTAMP, updatedAt: DEFAULT_TIMESTAMP }, ...groups];
}

function ensureDefaultCurrency(currencies: HabitCurrency[]): HabitCurrency[] {
  if (currencies.some((currency) => currency.id === DEFAULT_CURRENCY_ID && !currency.deletedAt)) return currencies;
  return [{ id: DEFAULT_CURRENCY_ID, name: '金币', icon: '🪙', sort: 0, createdAt: DEFAULT_TIMESTAMP, updatedAt: DEFAULT_TIMESTAMP }, ...currencies];
}

export function normalizeHabitSnapshot(input: unknown): HabitSnapshot {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  return {
    habits: normalizeArray(source.habits, normalizeHabit),
    habitGroups: ensureDefaultGroup(normalizeArray(source.habitGroups, normalizeGroup)),
    habitRecords: normalizeArray(source.habitRecords, normalizeHabitRecord),
    habitRewards: normalizeArray(source.habitRewards, normalizeReward),
    habitRewardRecords: normalizeArray(source.habitRewardRecords, normalizeRewardRecord),
    habitFineRecords: normalizeArray(source.habitFineRecords, normalizeFineRecord),
    habitLedger: normalizeArray(source.habitLedger, normalizeLedger),
    habitCurrencies: ensureDefaultCurrency(normalizeArray(source.habitCurrencies, normalizeCurrency)),
    habitMilestones: normalizeArray(source.habitMilestones, normalizeMilestone),
    habitMilestoneClaims: normalizeArray(source.habitMilestoneClaims, normalizeMilestoneClaim),
    habitOverdueEvents: normalizeArray(source.habitOverdueEvents, normalizeOverdue),
    habitMoodNotes: normalizeArray(source.habitMoodNotes, normalizeMoodNote),
    habitTimeTasks: normalizeArray(source.habitTimeTasks, normalizeTimeTask),
    deletedItems: normalizeArray(source.deletedItems, normalizeDeletedItem)
  };
}

function collectSoftDeletes(snapshot: HabitSnapshot): HabitDeletedItem[] {
  const items: HabitDeletedItem[] = [];
  const collect = (collection: HabitCollectionName, entries: HabitEntityBase[]) => {
    entries.forEach((entry) => {
      if (entry.deletedAt) items.push({ collection, id: entry.id, deletedAt: entry.deletedAt });
    });
  };
  collect('habits', snapshot.habits);
  collect('habitGroups', snapshot.habitGroups.filter((item) => item.id !== DEFAULT_GROUP_ID));
  collect('habitRecords', snapshot.habitRecords);
  collect('habitRewards', snapshot.habitRewards);
  collect('habitRewardRecords', snapshot.habitRewardRecords);
  collect('habitFineRecords', snapshot.habitFineRecords);
  collect('habitLedger', snapshot.habitLedger);
  collect('habitCurrencies', snapshot.habitCurrencies.filter((item) => item.id !== DEFAULT_CURRENCY_ID));
  collect('habitMilestones', snapshot.habitMilestones);
  collect('habitMilestoneClaims', snapshot.habitMilestoneClaims);
  collect('habitOverdueEvents', snapshot.habitOverdueEvents);
  collect('habitMoodNotes', snapshot.habitMoodNotes);
  collect('habitTimeTasks', snapshot.habitTimeTasks);
  return items;
}

function pruneDeletedItems(items: HabitDeletedItem[]): HabitDeletedItem[] {
  const map = new Map<string, HabitDeletedItem>();
  items.forEach((item) => {
    if ((item.collection === 'habitGroups' && item.id === DEFAULT_GROUP_ID) ||
        (item.collection === 'habitCurrencies' && item.id === DEFAULT_CURRENCY_ID)) {
      return;
    }
    const key = getDeletedKey(item.collection, item.id, item.parentId || '');
    const current = map.get(key);
    if (!current || normalizeTimestamp(item.deletedAt) > normalizeTimestamp(current.deletedAt)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values()).sort((a, b) => getDeletedKey(a.collection, a.id, a.parentId || '').localeCompare(getDeletedKey(b.collection, b.id, b.parentId || '')));
}

function buildDeletionMap(local: HabitSnapshot, remote: HabitSnapshot): Map<string, HabitDeletedItem> {
  const deleted = pruneDeletedItems([
    ...local.deletedItems,
    ...remote.deletedItems,
    ...collectSoftDeletes(local),
    ...collectSoftDeletes(remote)
  ]);
  return new Map(deleted.map((item) => [getDeletedKey(item.collection, item.id, item.parentId || ''), item]));
}

function shouldKeep(collection: HabitCollectionName, item: HabitEntityBase, deletionMap: Map<string, HabitDeletedItem>): boolean {
  if (collection === 'habitGroups' && item.id === DEFAULT_GROUP_ID) return true;
  if (collection === 'habitCurrencies' && item.id === DEFAULT_CURRENCY_ID) return true;
  if (item.deletedAt) return false;
  const deleted = deletionMap.get(getDeletedKey(collection, item.id));
  if (!deleted) return true;
  return getEntityTime(item) > normalizeTimestamp(deleted.deletedAt);
}

function mergeByKey<T extends HabitEntityBase>(
  collection: HabitCollectionName,
  localItems: T[],
  remoteItems: T[],
  deletionMap: Map<string, HabitDeletedItem>,
  getKey: (item: T, index: number) => string = (item) => `id:${item.id}`,
  choose?: (left: T, right: T) => T
): T[] {
  const merged = new Map<string, T>();
  [...localItems, ...remoteItems].forEach((item, index) => {
    if (!item?.id) return;
    const key = getKey(item, index);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, item);
      return;
    }
    merged.set(key, choose ? choose(current, item) : (getEntityTime(item) >= getEntityTime(current) ? item : current));
  });
  return Array.from(merged.values()).filter((item) => shouldKeep(collection, item, deletionMap));
}

function getRecordKey(item: HabitRecord, index: number): string {
  if (item.sourceKey) return `record-source:${item.sourceKey}`;
  return item.id ? `id:${item.id}` : `record:${item.habitId}:${item.recordTime}:${item.type}:${item.currencyId}:${item.amount}:${index}`;
}

function getRewardRecordKey(item: HabitRewardRecord, index: number): string {
  if (item.sourceKey) return `redeem-source:${item.sourceKey}`;
  return item.id ? `id:${item.id}` : `redeem:${item.rewardId}:${item.redeemedAt}:${item.currencyId}:${item.amount}:${index}`;
}

function getFineRecordKey(item: HabitFineRecord, index: number): string {
  if (item.sourceKey) return `fine-source:${item.sourceKey}`;
  return item.id ? `id:${item.id}` : `fine:${item.habitId}:${item.finedAt}:${item.currencyId}:${item.amount}:${item.reason}:${index}`;
}

function getLedgerKey(item: HabitLedgerEntry, index: number): string {
  if (item.sourceId) return `ledger:${item.type}:${item.sourceId}:${item.currencyId}`;
  if (item.id) return `id:${item.id}`;
  return ['ledger-fallback', item.type, item.habitId || '', item.rewardId || '', item.date || '', item.currencyId, String(item.amount || 0), item.note || '', String(index)].join(':');
}

function getClaimKey(item: HabitMilestoneClaim): string {
  return `claim:${item.habitId}:${item.milestoneId}:${item.cycleStartDate}:${item.achievedDays}:${item.currencyId}`;
}

function getOverdueKey(item: HabitOverdueEvent): string {
  return `overdue:${item.habitId}:${item.dueDate}`;
}

function chooseOverdue(left: HabitOverdueEvent, right: HabitOverdueEvent): HabitOverdueEvent {
  const leftTime = getEntityTime(left);
  const rightTime = getEntityTime(right);
  if (rightTime !== leftTime) return rightTime > leftTime ? right : left;
  const score = (status: HabitOverdueStatus) => TERMINAL_OVERDUE.has(status) ? 3 : status === 'deferred' ? 2 : 1;
  const rightScore = score(right.status);
  const leftScore = score(left.status);
  if (rightScore !== leftScore) return rightScore > leftScore ? right : left;
  return right.id >= left.id ? right : left;
}

export function mergeHabitSnapshots(localData: unknown, remoteData: unknown): HabitSnapshot {
  const local = normalizeHabitSnapshot(localData);
  const remote = normalizeHabitSnapshot(remoteData);
  const deletionMap = buildDeletionMap(local, remote);
  const deletedItems = pruneDeletedItems([...Array.from(deletionMap.values()), ...collectSoftDeletes(local), ...collectSoftDeletes(remote)]);

  return normalizeHabitSnapshot({
    habits: mergeByKey('habits', local.habits, remote.habits, deletionMap),
    habitGroups: mergeByKey('habitGroups', local.habitGroups, remote.habitGroups, deletionMap),
    habitRecords: mergeByKey('habitRecords', local.habitRecords, remote.habitRecords, deletionMap, getRecordKey),
    habitRewards: mergeByKey('habitRewards', local.habitRewards, remote.habitRewards, deletionMap),
    habitRewardRecords: mergeByKey('habitRewardRecords', local.habitRewardRecords, remote.habitRewardRecords, deletionMap, getRewardRecordKey),
    habitFineRecords: mergeByKey('habitFineRecords', local.habitFineRecords, remote.habitFineRecords, deletionMap, getFineRecordKey),
    habitLedger: mergeByKey('habitLedger', local.habitLedger, remote.habitLedger, deletionMap, getLedgerKey),
    habitCurrencies: mergeByKey('habitCurrencies', local.habitCurrencies, remote.habitCurrencies, deletionMap),
    habitMilestones: mergeByKey('habitMilestones', local.habitMilestones, remote.habitMilestones, deletionMap),
    habitMilestoneClaims: mergeByKey('habitMilestoneClaims', local.habitMilestoneClaims, remote.habitMilestoneClaims, deletionMap, getClaimKey),
    habitOverdueEvents: mergeByKey('habitOverdueEvents', local.habitOverdueEvents, remote.habitOverdueEvents, deletionMap, getOverdueKey, chooseOverdue),
    habitMoodNotes: mergeByKey('habitMoodNotes', local.habitMoodNotes, remote.habitMoodNotes, deletionMap),
    habitTimeTasks: mergeByKey('habitTimeTasks', local.habitTimeTasks, remote.habitTimeTasks, deletionMap),
    deletedItems
  });
}

function getHashPayload(snapshot: HabitSnapshot) {
  const normalized = normalizeHabitSnapshot(snapshot);
  return {
    ...normalized,
    deletedItems: pruneDeletedItems(normalized.deletedItems)
  };
}

export const habitAppAdapter: SyncAdapter<HabitSnapshot> = {
  appId: 'habit-app',
  schemaVersion: 1,
  createDefaultData() {
    return normalizeHabitSnapshot({});
  },
  normalizeData(input) {
    return normalizeHabitSnapshot(input);
  },
  merge(localData, remoteData) {
    return mergeHabitSnapshots(localData, remoteData);
  },
  getHash(data) {
    return createHash(getHashPayload(normalizeHabitSnapshot(data)));
  },
  getStorageKeys() {
    return {
      dataKey: 'habitAppData',
      metadataKey: 'habitAppSyncState',
      providerConfigKey: 'habitAppSyncConfig'
    };
  },
  getDefaultRemotePath() {
    return '/apps/habit-app/data.json';
  }
};
