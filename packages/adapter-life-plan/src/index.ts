import { createHash, type SyncAdapter } from '@app-sync-kit/sync-core';

const LIFE_PLAN_COLLECTIONS = [
  'records',
  'todos',
  'habits',
  'checkins',
  'templates',
  'goals',
  'materials',
  'wheels',
  'wheelTags',
  'wheelLibraryItems',
  'wheelHistory'
] as const;

type LifePlanCollection = (typeof LIFE_PLAN_COLLECTIONS)[number];

export interface DeletedItemRecord {
  collection: string;
  id: string;
  deletedAt: string;
}

export type LifePlanItem = Record<string, unknown>;

export type LifePlanData = Record<LifePlanCollection, LifePlanItem[]> & {
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
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as LifePlanItem[] : [];
}

function getItemMergeKey(item: LifePlanItem, fallbackIndex: number): string {
  if (typeof item.id === 'string' && item.id) return `id:${item.id}`;
  if (typeof item.habitId === 'string' && typeof item.date === 'string') return `habit:${item.habitId}:${item.date}`;
  if (typeof item.type === 'string' && typeof item.period === 'string') return `period:${item.type}:${item.period}`;
  if (typeof item.title === 'string' && typeof item.date === 'string') return `title:${item.title}:${item.date}`;
  return `json:${fallbackIndex}:${JSON.stringify(item)}`;
}

function getItemUpdatedTime(item: LifePlanItem): number {
  const candidate = item.updatedAt ?? item.completedAt ?? item.createdAt ?? item.date ?? item.recordTime;
  const timestamp = new Date(String(candidate ?? '')).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function buildDeletionMap(localData: LifePlanData, remoteData: LifePlanData): Map<string, DeletedItemRecord> {
  const map = new Map<string, DeletedItemRecord>();

  [...localData.deletedItems, ...remoteData.deletedItems].forEach((item) => {
    if (!item?.collection || !item?.id) return;
    const key = `${item.collection}:${item.id}`;
    const current = map.get(key);

    if (!current || new Date(item.deletedAt).getTime() >= new Date(current.deletedAt).getTime()) {
      map.set(key, item);
    }
  });

  return map;
}

function shouldKeepItem(collection: string, item: LifePlanItem, deletions: Map<string, DeletedItemRecord>): boolean {
  if (typeof item.id !== 'string' || !item.id) return true;
  const deleted = deletions.get(`${collection}:${item.id}`);
  if (!deleted) return true;
  return getItemUpdatedTime(item) > new Date(deleted.deletedAt).getTime();
}

function mergeArray(
  collection: string,
  localItems: LifePlanItem[],
  remoteItems: LifePlanItem[],
  deletions: Map<string, DeletedItemRecord>
): LifePlanItem[] {
  const merged = new Map<string, LifePlanItem>();

  localItems.forEach((item, index) => {
    merged.set(getItemMergeKey(item, index), item);
  });

  remoteItems.forEach((item, index) => {
    const key = getItemMergeKey(item, index);
    const current = merged.get(key);

    if (!current || getItemUpdatedTime(item) >= getItemUpdatedTime(current)) {
      merged.set(key, item);
    }
  });

  return Array.from(merged.values()).filter((item) => shouldKeepItem(collection, item, deletions));
}

export function normalizeLifePlanData(input: unknown): LifePlanData {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const base = createDefaultCollectionState();

  LIFE_PLAN_COLLECTIONS.forEach((key) => {
    base[key] = normalizeArray(source[key]);
  });

  return {
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
  };
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
    const merged = normalizeLifePlanData({});

    LIFE_PLAN_COLLECTIONS.forEach((collection) => {
      merged[collection] = mergeArray(
        collection,
        normalizedLocal[collection],
        normalizedRemote[collection],
        deletions
      );
    });

    merged.deletedItems = Array.from(deletions.values());
    return merged;
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
    return '/apps/life-plan/data.json';
  }
};
