import { createHash, type SyncAdapter } from '@app-sync-kit/sync-core';

export interface WheelEntityBase {
  id: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export interface WheelItem extends WheelEntityBase {
  name: string;
  weight: number;
  note?: string;
  enabled: boolean;
  tagIds?: string[];
  sourceLibraryItemId?: string;
}

export interface WheelTag extends WheelEntityBase {
  name: string;
  color: string;
  weight: number;
  enabled: boolean;
}

export interface Wheel extends WheelEntityBase {
  name: string;
  mode: 'normal' | 'tag';
  items: WheelItem[];
  tagIds?: string[];
}

export interface WheelHistoryItem extends WheelEntityBase {
  wheelId: string;
  wheelName: string;
  mode: 'normal' | 'tag';
  tagId?: string;
  tagName?: string;
  resultId?: string;
  resultName: string;
  note?: string;
  convertedTodoId?: string;
}

export interface WheelDeletedItem {
  collection: string;
  id: string;
  deletedAt: string;
  parentId?: string;
}

export interface WheelSnapshot {
  wheels: Wheel[];
  wheelTags: WheelTag[];
  wheelLibraryItems: WheelItem[];
  wheelHistory: WheelHistoryItem[];
  /** Compatible with life-plan-site wheel slice tombstones. */
  deletedItems?: WheelDeletedItem[];
}

const WHEEL_DELETION_COLLECTIONS = new Set([
  'wheels',
  'wheelTags',
  'wheelLibraryItems',
  'wheelHistory',
  'wheelItems'
]);

function normalizeTimestamp(value: string | undefined | null): number {
  const timestamp = new Date(String(value ?? '')).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getEntityTime(item: WheelEntityBase | undefined): number {
  if (!item) return 0;
  return normalizeTimestamp(item.updatedAt ?? item.createdAt ?? item.deletedAt);
}

function pickLatest<T extends WheelEntityBase>(left: T | undefined, right: T | undefined): T | undefined {
  if (!left) return right;
  if (!right) return left;
  return getEntityTime(right) >= getEntityTime(left) ? right : left;
}

function getDeletedKey(collection: string, id: string, parentId = '') {
  return parentId ? `${collection}:${parentId}:${id}` : `${collection}:${id}`;
}

function buildDeletionMap(local: WheelSnapshot, remote: WheelSnapshot) {
  const map = new Map<string, WheelDeletedItem>();
  const sources = [...(local.deletedItems || []), ...(remote.deletedItems || [])];
  sources.forEach((item) => {
    if (!item?.collection || !item?.id || !item?.deletedAt) return;
    if (!WHEEL_DELETION_COLLECTIONS.has(item.collection)) return;
    const key = getDeletedKey(item.collection, item.id, item.parentId || '');
    const existing = map.get(key);
    if (!existing || normalizeTimestamp(item.deletedAt) > normalizeTimestamp(existing.deletedAt)) {
      map.set(key, {
        collection: item.collection,
        id: item.id,
        deletedAt: item.deletedAt,
        parentId: item.parentId
      });
    }
  });

  // Soft-deleted entities also act as tombstones for life-plan compatibility.
  const collectSoftDeletes = (collection: string, items: WheelEntityBase[], parentId = '') => {
    items.forEach((item) => {
      if (!item?.id || !item.deletedAt) return;
      const key = getDeletedKey(collection, item.id, parentId);
      const candidate: WheelDeletedItem = {
        collection,
        id: item.id,
        deletedAt: item.deletedAt,
        parentId: parentId || undefined
      };
      const existing = map.get(key);
      if (!existing || normalizeTimestamp(candidate.deletedAt) > normalizeTimestamp(existing.deletedAt)) {
        map.set(key, candidate);
      }
    });
  };

  collectSoftDeletes('wheels', local.wheels);
  collectSoftDeletes('wheels', remote.wheels);
  collectSoftDeletes('wheelTags', local.wheelTags);
  collectSoftDeletes('wheelTags', remote.wheelTags);
  collectSoftDeletes('wheelLibraryItems', local.wheelLibraryItems);
  collectSoftDeletes('wheelLibraryItems', remote.wheelLibraryItems);
  collectSoftDeletes('wheelHistory', local.wheelHistory);
  collectSoftDeletes('wheelHistory', remote.wheelHistory);
  [...local.wheels, ...remote.wheels].forEach((wheel) => {
    if (!wheel?.id) return;
    collectSoftDeletes('wheelItems', wheel.items || [], wheel.id);
  });

  return map;
}

function shouldKeepEntity(
  collection: string,
  item: WheelEntityBase,
  deletionMap: Map<string, WheelDeletedItem>,
  parentId = ''
) {
  if (item.deletedAt) return false;
  const deleted = deletionMap.get(getDeletedKey(collection, item.id, parentId));
  if (!deleted) return true;
  return getEntityTime(item) > normalizeTimestamp(deleted.deletedAt);
}

function mergeByLatest<T extends WheelEntityBase>(
  localItems: T[],
  remoteItems: T[],
  collection: string,
  deletionMap: Map<string, WheelDeletedItem>,
  parentId = ''
): T[] {
  const merged = new Map<string, T>();

  [...localItems, ...remoteItems].forEach((item) => {
    if (!item?.id) return;
    const current = merged.get(item.id);
    if (!current || getEntityTime(item) >= getEntityTime(current)) {
      merged.set(item.id, item);
    }
  });

  return Array.from(merged.values()).filter((item) => shouldKeepEntity(collection, item, deletionMap, parentId));
}

function normalizeWheelItem(input: unknown): WheelItem | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Partial<WheelItem>;
  if (!item.id || typeof item.id !== 'string') return null;

  return {
    id: item.id,
    name: typeof item.name === 'string' && item.name ? item.name : '未命名选项',
    weight: Math.max(1, Number(item.weight) || 1),
    note: typeof item.note === 'string' ? item.note : '',
    enabled: item.enabled !== false,
    tagIds: Array.isArray(item.tagIds)
      ? item.tagIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : undefined,
    sourceLibraryItemId:
      typeof item.sourceLibraryItemId === 'string' && item.sourceLibraryItemId
        ? item.sourceLibraryItemId
        : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.createdAt,
    deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : undefined
  };
}

function normalizeWheelTag(input: unknown): WheelTag | null {
  if (!input || typeof input !== 'object') return null;
  const tag = input as Partial<WheelTag>;
  if (!tag.id || typeof tag.id !== 'string') return null;

  return {
    id: tag.id,
    name: typeof tag.name === 'string' && tag.name ? tag.name : '未命名标签',
    color: typeof tag.color === 'string' && tag.color ? tag.color : '#216e4e',
    weight: Math.max(1, Number(tag.weight) || 1),
    enabled: tag.enabled !== false,
    createdAt: typeof tag.createdAt === 'string' ? tag.createdAt : undefined,
    updatedAt: typeof tag.updatedAt === 'string' ? tag.updatedAt : tag.createdAt,
    deletedAt: typeof tag.deletedAt === 'string' ? tag.deletedAt : undefined
  };
}

function normalizeWheelHistoryItem(input: unknown): WheelHistoryItem | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Partial<WheelHistoryItem>;
  if (!item.id || typeof item.id !== 'string') return null;

  return {
    id: item.id,
    wheelId: typeof item.wheelId === 'string' ? item.wheelId : '',
    wheelName: typeof item.wheelName === 'string' && item.wheelName ? item.wheelName : '未命名转盘',
    mode: item.mode === 'tag' ? 'tag' : 'normal',
    tagId: typeof item.tagId === 'string' && item.tagId ? item.tagId : undefined,
    tagName: typeof item.tagName === 'string' && item.tagName ? item.tagName : undefined,
    resultId: typeof item.resultId === 'string' && item.resultId ? item.resultId : undefined,
    resultName: typeof item.resultName === 'string' && item.resultName ? item.resultName : '未命名结果',
    note: typeof item.note === 'string' ? item.note : '',
    convertedTodoId: typeof item.convertedTodoId === 'string' ? item.convertedTodoId : '',
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
    updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : item.createdAt,
    deletedAt: typeof item.deletedAt === 'string' ? item.deletedAt : undefined
  };
}

function normalizeWheel(input: unknown): Wheel | null {
  if (!input || typeof input !== 'object') return null;
  const wheel = input as Partial<Wheel>;
  if (!wheel.id || typeof wheel.id !== 'string') return null;

  return {
    id: wheel.id,
    name: typeof wheel.name === 'string' && wheel.name ? wheel.name : '未命名转盘',
    mode: wheel.mode === 'tag' ? 'tag' : 'normal',
    items: Array.isArray(wheel.items)
      ? wheel.items.map(normalizeWheelItem).filter((item): item is WheelItem => !!item)
      : [],
    tagIds: Array.isArray(wheel.tagIds)
      ? wheel.tagIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : undefined,
    createdAt: typeof wheel.createdAt === 'string' ? wheel.createdAt : undefined,
    updatedAt: typeof wheel.updatedAt === 'string' ? wheel.updatedAt : wheel.createdAt,
    deletedAt: typeof wheel.deletedAt === 'string' ? wheel.deletedAt : undefined
  };
}

function normalizeDeletedItem(input: unknown): WheelDeletedItem | null {
  if (!input || typeof input !== 'object') return null;
  const item = input as Partial<WheelDeletedItem>;
  if (!item.collection || !item.id || !item.deletedAt) return null;
  if (!WHEEL_DELETION_COLLECTIONS.has(String(item.collection))) return null;
  return {
    collection: String(item.collection),
    id: String(item.id),
    deletedAt: String(item.deletedAt),
    parentId: typeof item.parentId === 'string' && item.parentId ? item.parentId : undefined
  };
}

export function normalizeWheelSnapshot(input: unknown): WheelSnapshot {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

  return {
    wheels: Array.isArray(source.wheels)
      ? source.wheels.map(normalizeWheel).filter((item): item is Wheel => !!item)
      : [],
    wheelTags: Array.isArray(source.wheelTags)
      ? source.wheelTags.map(normalizeWheelTag).filter((item): item is WheelTag => !!item)
      : [],
    wheelLibraryItems: Array.isArray(source.wheelLibraryItems)
      ? source.wheelLibraryItems.map(normalizeWheelItem).filter((item): item is WheelItem => !!item)
      : [],
    wheelHistory: Array.isArray(source.wheelHistory)
      ? source.wheelHistory.map(normalizeWheelHistoryItem).filter((item): item is WheelHistoryItem => !!item)
      : [],
    deletedItems: Array.isArray(source.deletedItems)
      ? source.deletedItems.map(normalizeDeletedItem).filter((item): item is WheelDeletedItem => !!item)
      : []
  };
}

function collectSoftDeleteTombstones(snapshot: WheelSnapshot): WheelDeletedItem[] {
  const items: WheelDeletedItem[] = [];
  snapshot.wheels.forEach((wheel) => {
    if (wheel.deletedAt) {
      items.push({ collection: 'wheels', id: wheel.id, deletedAt: wheel.deletedAt });
    }
    (wheel.items || []).forEach((item) => {
      if (item.deletedAt) {
        items.push({
          collection: 'wheelItems',
          id: item.id,
          deletedAt: item.deletedAt,
          parentId: wheel.id
        });
      }
    });
  });
  snapshot.wheelTags.forEach((tag) => {
    if (tag.deletedAt) items.push({ collection: 'wheelTags', id: tag.id, deletedAt: tag.deletedAt });
  });
  snapshot.wheelLibraryItems.forEach((item) => {
    if (item.deletedAt) {
      items.push({ collection: 'wheelLibraryItems', id: item.id, deletedAt: item.deletedAt });
    }
  });
  snapshot.wheelHistory.forEach((item) => {
    if (item.deletedAt) {
      items.push({ collection: 'wheelHistory', id: item.id, deletedAt: item.deletedAt });
    }
  });
  return items;
}

function pruneDeletedItems(items: WheelDeletedItem[]): WheelDeletedItem[] {
  const map = new Map<string, WheelDeletedItem>();
  items.forEach((item) => {
    if (!item?.collection || !item?.id || !item?.deletedAt) return;
    const key = getDeletedKey(item.collection, item.id, item.parentId || '');
    const existing = map.get(key);
    if (!existing || normalizeTimestamp(item.deletedAt) > normalizeTimestamp(existing.deletedAt)) {
      map.set(key, item);
    }
  });
  return Array.from(map.values());
}

export function mergeWheelSnapshots(localData: unknown, remoteData: unknown): WheelSnapshot {
  const local = normalizeWheelSnapshot(localData);
  const remote = normalizeWheelSnapshot(remoteData);
  const deletionMap = buildDeletionMap(local, remote);
  const remoteWheelMap = new Map(remote.wheels.map((wheel) => [wheel.id, wheel]));

  const wheels = mergeByLatest(local.wheels, remote.wheels, 'wheels', deletionMap).map((wheel) => {
    const localWheel = local.wheels.find((item) => item.id === wheel.id);
    const remoteWheel = remoteWheelMap.get(wheel.id);
    const baseWheel = pickLatest(localWheel, remoteWheel) ?? wheel;
    return {
      ...baseWheel,
      items: mergeByLatest(localWheel?.items ?? [], remoteWheel?.items ?? [], 'wheelItems', deletionMap, wheel.id)
    };
  });

  return {
    wheels,
    wheelTags: mergeByLatest(local.wheelTags, remote.wheelTags, 'wheelTags', deletionMap),
    wheelLibraryItems: mergeByLatest(
      local.wheelLibraryItems,
      remote.wheelLibraryItems,
      'wheelLibraryItems',
      deletionMap
    ),
    wheelHistory: mergeByLatest(local.wheelHistory, remote.wheelHistory, 'wheelHistory', deletionMap),
    deletedItems: pruneDeletedItems([
      ...Array.from(deletionMap.values()),
      ...collectSoftDeleteTombstones(local),
      ...collectSoftDeleteTombstones(remote)
    ])
  };
}

/** Hash ignores tombstone list order noise by hashing active business collections. */
function getHashPayload(snapshot: WheelSnapshot) {
  return {
    wheels: snapshot.wheels,
    wheelTags: snapshot.wheelTags,
    wheelLibraryItems: snapshot.wheelLibraryItems,
    wheelHistory: snapshot.wheelHistory,
    deletedItems: snapshot.deletedItems || []
  };
}

export const wheelAppAdapter: SyncAdapter<WheelSnapshot> = {
  appId: 'wheel-app',
  schemaVersion: 1,
  createDefaultData() {
    return normalizeWheelSnapshot({});
  },
  normalizeData(input) {
    return normalizeWheelSnapshot(input);
  },
  merge(localData, remoteData) {
    return mergeWheelSnapshots(localData, remoteData);
  },
  getHash(data) {
    return createHash(getHashPayload(normalizeWheelSnapshot(data)));
  },
  getStorageKeys() {
    return {
      dataKey: 'wheelAppData',
      metadataKey: 'wheelAppSyncState',
      providerConfigKey: 'wheelAppSyncConfig'
    };
  },
  getDefaultRemotePath() {
    return '/apps/wheel-app/data.json';
  }
};
