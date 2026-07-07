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

export interface WheelSnapshot {
  wheels: Wheel[];
  wheelTags: WheelTag[];
  wheelLibraryItems: WheelItem[];
  wheelHistory: WheelHistoryItem[];
}

function normalizeTimestamp(value: string | undefined | null): number {
  const timestamp = new Date(String(value ?? '')).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickLatest<T extends WheelEntityBase>(left: T | undefined, right: T | undefined): T | undefined {
  if (!left) return right;
  if (!right) return left;
  return normalizeTimestamp(right.updatedAt ?? right.createdAt) >= normalizeTimestamp(left.updatedAt ?? left.createdAt)
    ? right
    : left;
}

function mergeByLatest<T extends WheelEntityBase>(localItems: T[], remoteItems: T[]): T[] {
  const merged = new Map<string, T>();

  [...localItems, ...remoteItems].forEach((item) => {
    if (!item?.id) return;
    const current = merged.get(item.id);
    if (!current || normalizeTimestamp(item.updatedAt ?? item.createdAt) >= normalizeTimestamp(current.updatedAt ?? current.createdAt)) {
      merged.set(item.id, item);
    }
  });

  return Array.from(merged.values()).filter((item) => !item.deletedAt);
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
    sourceLibraryItemId: typeof item.sourceLibraryItemId === 'string' && item.sourceLibraryItemId ? item.sourceLibraryItemId : undefined,
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
    items: Array.isArray(wheel.items) ? wheel.items.map(normalizeWheelItem).filter((item): item is WheelItem => !!item) : [],
    tagIds: Array.isArray(wheel.tagIds)
      ? wheel.tagIds.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
      : undefined,
    createdAt: typeof wheel.createdAt === 'string' ? wheel.createdAt : undefined,
    updatedAt: typeof wheel.updatedAt === 'string' ? wheel.updatedAt : wheel.createdAt,
    deletedAt: typeof wheel.deletedAt === 'string' ? wheel.deletedAt : undefined
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
      : []
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
    const local = normalizeWheelSnapshot(localData);
    const remote = normalizeWheelSnapshot(remoteData);
    const remoteWheelMap = new Map(remote.wheels.map((wheel) => [wheel.id, wheel]));

    return {
      wheels: mergeByLatest(local.wheels, remote.wheels).map((wheel) => {
        const localWheel = local.wheels.find((item) => item.id === wheel.id);
        const remoteWheel = remoteWheelMap.get(wheel.id);
        const baseWheel = pickLatest(localWheel, remoteWheel) ?? wheel;

        return {
          ...baseWheel,
          items: mergeByLatest(localWheel?.items ?? [], remoteWheel?.items ?? [])
        };
      }),
      wheelTags: mergeByLatest(local.wheelTags, remote.wheelTags),
      wheelLibraryItems: mergeByLatest(local.wheelLibraryItems, remote.wheelLibraryItems),
      wheelHistory: mergeByLatest(local.wheelHistory, remote.wheelHistory)
    };
  },
  getHash(data) {
    return createHash(data);
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
