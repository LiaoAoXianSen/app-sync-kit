import { createHash, type SyncAdapter } from '@app-sync-kit/sync-core';

const LIFE_PLAN_COLLECTIONS = [
  'records',
  'todos',
  'habits',
  'checkins',
  'habitPointLedger',
  'habitRewards',
  'habitCurrencies',
  'templates',
  'goals',
  'materials',
  'wheels',
  'wheelTags',
  'wheelLibraryItems',
  'wheelHistory'
] as const;

type LifePlanCollection = (typeof LIFE_PLAN_COLLECTIONS)[number];

const WHEEL_DELETION_COLLECTIONS = new Set([
  'wheels',
  'wheelTags',
  'wheelLibraryItems',
  'wheelHistory',
  'wheelItems'
]);

export interface DeletedItemRecord {
  collection: string;
  id: string;
  deletedAt: string;
  [key: string]: unknown;
}

export type LifePlanItem = Record<string, unknown>;

export type LifePlanData = Record<string, unknown> &
  Record<LifePlanCollection, LifePlanItem[]> & {
    deletedItems: DeletedItemRecord[];
  };

function createDefaultCollectionState(): Record<LifePlanCollection, LifePlanItem[]> {
  return LIFE_PLAN_COLLECTIONS.reduce(
    (state, key) => {
      state[key] = [];
      return state;
    },
    {} as Record<LifePlanCollection, LifePlanItem[]>
  );
}

function normalizeArray(value: unknown): LifePlanItem[] {
  return Array.isArray(value)
    ? (value.filter((item) => item && typeof item === 'object') as LifePlanItem[])
    : [];
}

function getString(item: LifePlanItem, key: string): string {
  const value = item[key];
  return typeof value === 'string' ? value : '';
}

function normalizeHabitCurrency(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '金币';
}

function getHabitLedgerMergeKey(item: LifePlanItem): string {
  const type = getString(item, 'type');
  const sourceId = getString(item, 'sourceId');
  if (sourceId && ['checkin', 'milestone', 'reverse', 'miss', 'break', 'reverse-penalty'].includes(type)) {
    return `ledger:${type}:${sourceId}:${normalizeHabitCurrency(item.currency)}`;
  }
  return '';
}

function getItemMergeKey(item: LifePlanItem, fallbackIndex: number, collection = ''): string {
  if (!item || typeof item !== 'object') return `value-${fallbackIndex}`;
  if (collection === 'habitPointLedger') return getHabitLedgerMergeKey(item) || (getString(item, 'id') ? `id:${getString(item, 'id')}` : `value-${fallbackIndex}`);
  if (getString(item, 'id')) return `id:${getString(item, 'id')}`;
  if (getString(item, 'habitId') && getString(item, 'date')) return `habit:${getString(item, 'habitId')}:${getString(item, 'date')}`;
  if (getString(item, 'type') && getString(item, 'period')) return `period:${getString(item, 'type')}:${getString(item, 'period')}`;
  if (getString(item, 'title') && getString(item, 'date')) return `title:${getString(item, 'title')}:${getString(item, 'date')}`;
  return `json:${JSON.stringify(item)}`;
}

function getItemUpdatedTime(item?: LifePlanItem): number {
  if (!item || typeof item !== 'object') return 0;
  const raw = item.updatedAt ?? item.completedAt ?? item.createdAt ?? item.date ?? item.recordTime ?? '';
  const timestamp = new Date(String(raw)).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getDeletedItemKey(collection: string, id: string): string {
  return `${collection}:${id}`;
}

function buildDeletionMap(localData: LifePlanData, remoteData: LifePlanData): Map<string, DeletedItemRecord> {
  const map = new Map<string, DeletedItemRecord>();

  [...localData.deletedItems, ...remoteData.deletedItems].forEach((item) => {
    if (!item?.collection || !item?.id) return;
    const key = getDeletedItemKey(item.collection, item.id);
    const current = map.get(key);

    if (!current || new Date(item.deletedAt || 0).getTime() > new Date(current.deletedAt || 0).getTime()) {
      map.set(key, item);
    }
  });

  return map;
}

function shouldKeepMergedItem(collection: string, item: LifePlanItem, deletions: Map<string, DeletedItemRecord>): boolean {
  const id = getString(item, 'id');
  if (!id) return true;
  const deleted = deletions.get(getDeletedItemKey(collection, id));
  if (!deleted) return true;
  return getItemUpdatedTime(item) > new Date(deleted.deletedAt || 0).getTime();
}

function mergeArrayByIdentity(
  collection: string,
  localItems: LifePlanItem[] = [],
  remoteItems: LifePlanItem[] = [],
  deletions = new Map<string, DeletedItemRecord>()
): LifePlanItem[] {
  const merged = new Map<string, LifePlanItem>();

  localItems.forEach((item, index) => merged.set(getItemMergeKey(item, index, collection), item));
  remoteItems.forEach((remoteItem, index) => {
    const key = getItemMergeKey(remoteItem, index, collection);
    const localItem = merged.get(key);
    if (!localItem || getItemUpdatedTime(remoteItem) >= getItemUpdatedTime(localItem)) {
      merged.set(key, remoteItem);
    }
  });

  return Array.from(merged.values()).filter((item) => shouldKeepMergedItem(collection, item, deletions));
}

function normalizeRecordMergeText(text = ''): string {
  return String(text || '').replace(/\r\n/g, '\n');
}

function normalizeRecordCompareText(text = ''): string {
  return normalizeRecordMergeText(text).replace(/[\s，。！？、；：,.!?;:"'“”‘’（）()【】[\]《》<>#\-_*`~]+/g, '');
}

function isTextSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true;
  if (!haystack) return false;
  let index = 0;
  for (let i = 0; i < haystack.length && index < needle.length; i += 1) {
    if (haystack[i] === needle[index]) index += 1;
  }
  return index === needle.length;
}

function isRecordTextSuperset(candidateText: string, otherText: string): boolean {
  if (!otherText) return !!candidateText;
  if (!candidateText) return false;
  if (candidateText.includes(otherText)) return true;
  return isTextSubsequence(normalizeRecordCompareText(otherText), normalizeRecordCompareText(candidateText));
}

function getRecordMergeStamp(...items: LifePlanItem[]): string {
  const winner = items
    .filter(Boolean)
    .sort((a, b) => getItemUpdatedTime(b) - getItemUpdatedTime(a))[0];
  return getString(winner, 'updatedAt') || getString(winner, 'createdAt') || new Date().toISOString();
}

function hasRecordConflictCopy(records: LifePlanItem[], originalId: string, contentHash: string): boolean {
  return records.some((record) => record?.conflictOf === originalId && record.conflictContentHash === contentHash);
}

function createRecordConflictCopy(
  record: LifePlanItem,
  originalId: string,
  sourceLabel: string,
  existingRecords: LifePlanItem[] = []
): LifePlanItem | null {
  const contentHash = createHash(normalizeRecordMergeText(getString(record, 'content')));
  if (!contentHash || hasRecordConflictCopy(existingRecords, originalId, contentHash)) return null;
  const stamp = new Date().toISOString();
  const baseTitle = getString(record, 'title') || getString(record, 'startDate') || getString(record, 'createdAt') || '未命名记录';

  return {
    ...record,
    id: `${originalId}-conflict-${contentHash}`,
    title: `${baseTitle}（冲突副本-${sourceLabel}）`,
    conflictOf: originalId,
    conflictSource: sourceLabel,
    conflictContentHash: contentHash,
    conflictCreatedAt: stamp,
    createdAt: getString(record, 'createdAt') || stamp,
    updatedAt: getString(record, 'updatedAt') || getString(record, 'createdAt') || stamp
  };
}

function mergeRecordPair(localRecord: LifePlanItem, remoteRecord: LifePlanItem, existingRecords: LifePlanItem[] = []) {
  const localText = normalizeRecordMergeText(getString(localRecord, 'content'));
  const remoteText = normalizeRecordMergeText(getString(remoteRecord, 'content'));
  const localTime = getItemUpdatedTime(localRecord);
  const remoteTime = getItemUpdatedTime(remoteRecord);
  const latest = remoteTime >= localTime ? remoteRecord : localRecord;
  const older = latest === remoteRecord ? localRecord : remoteRecord;
  const olderSource = older === localRecord ? '本地' : '云端';

  if (localText === remoteText) {
    return { primary: latest, conflict: null };
  }

  const localIsSuperset = isRecordTextSuperset(localText, remoteText);
  const remoteIsSuperset = isRecordTextSuperset(remoteText, localText);
  if (localIsSuperset || remoteIsSuperset) {
    const supersetRecord = remoteIsSuperset && !localIsSuperset ? remoteRecord : localRecord;
    return {
      primary: {
        ...supersetRecord,
        ...latest,
        content: getString(supersetRecord, 'content'),
        updatedAt: getRecordMergeStamp(localRecord, remoteRecord)
      },
      conflict: null
    };
  }

  return {
    primary: latest,
    conflict: createRecordConflictCopy(older, getString(latest, 'id') || getString(older, 'id'), olderSource, existingRecords)
  };
}

function mergeRecordsByIdentity(
  localItems: LifePlanItem[] = [],
  remoteItems: LifePlanItem[] = [],
  deletions = new Map<string, DeletedItemRecord>()
): LifePlanItem[] {
  const merged = new Map<string, LifePlanItem>();
  const conflictCopies: LifePlanItem[] = [];

  localItems.forEach((item, index) => merged.set(getItemMergeKey(item, index, 'records'), item));
  remoteItems.forEach((remoteItem, index) => {
    const key = getItemMergeKey(remoteItem, index, 'records');
    const localItem = merged.get(key);
    if (!localItem) {
      merged.set(key, remoteItem);
      return;
    }

    const existingRecords = [...localItems, ...remoteItems, ...Array.from(merged.values()), ...conflictCopies];
    const { primary, conflict } = mergeRecordPair(localItem, remoteItem, existingRecords);
    merged.set(key, primary);
    if (conflict) conflictCopies.push(conflict);
  });

  return [...Array.from(merged.values()), ...conflictCopies]
    .filter((item) => shouldKeepMergedItem('records', item, deletions));
}

function isWheelDeletionCollection(collection = ''): boolean {
  return WHEEL_DELETION_COLLECTIONS.has(collection);
}

function getWheelSnapshot(source: Partial<LifePlanData> = {}) {
  return {
    wheels: normalizeArray(source.wheels),
    wheelTags: normalizeArray(source.wheelTags),
    wheelLibraryItems: normalizeArray(source.wheelLibraryItems),
    wheelHistory: normalizeArray(source.wheelHistory),
    deletedItems: Array.isArray(source.deletedItems)
      ? source.deletedItems.filter((item) => isWheelDeletionCollection(item?.collection))
      : []
  };
}

function getWheelEntityUpdatedTime(item: LifePlanItem): number {
  return getItemUpdatedTime(item);
}

function mergeWheelEntities(
  localItems: LifePlanItem[] = [],
  remoteItems: LifePlanItem[] = [],
  collection = '',
  deletions = new Map<string, DeletedItemRecord>()
): LifePlanItem[] {
  const merged = new Map<string, LifePlanItem>();

  [...localItems, ...remoteItems].forEach((item, index) => {
    const key = getString(item, 'id') || JSON.stringify(item) || String(index);
    const current = merged.get(key);
    if (!current || getWheelEntityUpdatedTime(item) >= getWheelEntityUpdatedTime(current)) {
      merged.set(key, item);
    }
  });

  return Array.from(merged.values())
    .filter((item) => !item?.deletedAt)
    .filter((item) => !collection || shouldKeepMergedItem(collection, item, deletions));
}

function mergeWheelSnapshots(localSnapshot: Partial<LifePlanData>, remoteSnapshot: Partial<LifePlanData>) {
  const local = getWheelSnapshot(localSnapshot);
  const remote = getWheelSnapshot(remoteSnapshot);
  const deletions = buildDeletionMap(normalizeLifePlanData(localSnapshot), normalizeLifePlanData(remoteSnapshot));
  const remoteWheelMap = new Map(remote.wheels.map((item) => [getString(item, 'id'), item]));

  return {
    wheels: mergeWheelEntities(local.wheels, remote.wheels, 'wheels', deletions).map((wheel) => {
      const wheelId = getString(wheel, 'id');
      const localWheel = local.wheels.find((item) => getString(item, 'id') === wheelId);
      const remoteWheel = remoteWheelMap.get(wheelId);
      const baseWheel = !localWheel
        ? remoteWheel
        : !remoteWheel
          ? localWheel
          : getWheelEntityUpdatedTime(remoteWheel) >= getWheelEntityUpdatedTime(localWheel)
            ? remoteWheel
            : localWheel;

      return {
        ...baseWheel,
        items: mergeWheelEntities(
          normalizeArray(localWheel?.items),
          normalizeArray(remoteWheel?.items),
          'wheelItems',
          deletions
        )
      };
    }),
    wheelTags: mergeWheelEntities(local.wheelTags, remote.wheelTags, 'wheelTags', deletions),
    wheelLibraryItems: mergeWheelEntities(local.wheelLibraryItems, remote.wheelLibraryItems, 'wheelLibraryItems', deletions),
    wheelHistory: mergeWheelEntities(local.wheelHistory, remote.wheelHistory, 'wheelHistory', deletions),
    deletedItems: Array.from(deletions.values()).filter((item) => isWheelDeletionCollection(item.collection))
  };
}

function pruneDeletedItems(target: LifePlanData): LifePlanData {
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  target.deletedItems = target.deletedItems.filter((item) => {
    const time = new Date(item.deletedAt || 0).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
  return target;
}

export function normalizeLifePlanData(input: unknown): LifePlanData {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const base = createDefaultCollectionState();

  LIFE_PLAN_COLLECTIONS.forEach((key) => {
    base[key] = normalizeArray(source[key]);
  });

  return {
    ...source,
    ...base,
    deletedItems: Array.isArray(source.deletedItems)
      ? source.deletedItems.filter(
          (item): item is DeletedItemRecord =>
            !!item &&
            typeof item === 'object' &&
            typeof (item as DeletedItemRecord).collection === 'string' &&
            typeof (item as DeletedItemRecord).id === 'string' &&
            typeof (item as DeletedItemRecord).deletedAt === 'string'
        )
      : []
  } as LifePlanData;
}

export const lifePlanAdapter: SyncAdapter<LifePlanData> = {
  appId: 'life-plan',
  schemaVersion: 1,
  createDefaultData() {
    return normalizeLifePlanData({});
  },
  normalizeData(input) {
    return normalizeLifePlanData(input);
  },
  merge(localData, remoteData) {
    const normalizedLocal = normalizeLifePlanData(localData);
    const normalizedRemote = normalizeLifePlanData(remoteData);
    const deletions = buildDeletionMap(normalizedLocal, normalizedRemote);
    const merged = normalizeLifePlanData({ ...normalizedLocal, ...normalizedRemote });
    const wheelSnapshot = mergeWheelSnapshots(normalizedLocal, normalizedRemote);

    merged.records = mergeRecordsByIdentity(normalizedLocal.records, normalizedRemote.records, deletions);
    merged.wheels = wheelSnapshot.wheels;
    merged.wheelTags = wheelSnapshot.wheelTags;
    merged.wheelLibraryItems = wheelSnapshot.wheelLibraryItems;
    merged.wheelHistory = wheelSnapshot.wheelHistory;

    LIFE_PLAN_COLLECTIONS.forEach((collection) => {
      if (['records', 'wheels', 'wheelTags', 'wheelLibraryItems', 'wheelHistory'].includes(collection)) return;
      merged[collection] = mergeArrayByIdentity(
        collection,
        normalizedLocal[collection],
        normalizedRemote[collection],
        deletions
      );
    });

    merged.deletedItems = Array.from(deletions.values());
    return pruneDeletedItems(merged);
  },
  getHash(data) {
    return createHash(data);
  },
  getStorageKeys() {
    return {
      dataKey: 'lifePlanData',
      metadataKey: 'lifePlanSyncState',
      providerConfigKey: 'lifePlanSyncConfig'
    };
  },
  getDefaultRemotePath() {
    return '/life-plan.json';
  }
};
