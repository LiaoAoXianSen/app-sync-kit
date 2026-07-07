import { createHash, type SyncAdapter } from '@app-sync-kit/sync-core';

export type PantryChefItem = Record<string, unknown>;

export interface PantryChefData {
  pantry: PantryChefItem[];
  stapleSeasonings: PantryChefItem[];
  shoppingList: PantryChefItem[];
  preferences: Record<string, unknown>;
}

function normalizeArray(value: unknown): PantryChefItem[] {
  return Array.isArray(value) ? value.filter((item): item is PantryChefItem => !!item && typeof item === 'object') : [];
}

function normalizeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function getMergeKey(item: PantryChefItem, fallbackIndex: number): string {
  if (typeof item.id === 'string' && item.id) return `id:${item.id}`;
  if (typeof item.name === 'string' && item.name) return `name:${item.name}`;
  if (typeof item.label === 'string' && item.label) return `label:${item.label}`;
  return `json:${fallbackIndex}:${JSON.stringify(item)}`;
}

function getUpdatedTime(item: PantryChefItem): number {
  const candidate = item.updatedAt ?? item.createdAt ?? item.checkedAt ?? item.addedAt;
  const timestamp = new Date(String(candidate ?? '')).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function mergeCollection(localItems: PantryChefItem[], remoteItems: PantryChefItem[]): PantryChefItem[] {
  const merged = new Map<string, PantryChefItem>();

  localItems.forEach((item, index) => {
    merged.set(getMergeKey(item, index), item);
  });

  remoteItems.forEach((item, index) => {
    const key = getMergeKey(item, index);
    const current = merged.get(key);

    if (!current || getUpdatedTime(item) >= getUpdatedTime(current)) {
      merged.set(key, item);
    }
  });

  return Array.from(merged.values()).filter((item) => !item.deletedAt);
}

export function normalizePantryChefData(input: unknown): PantryChefData {
  const source = normalizeObject(input);

  return {
    pantry: normalizeArray(source.pantry),
    stapleSeasonings: normalizeArray(source.stapleSeasonings),
    shoppingList: normalizeArray(source.shoppingList),
    preferences: normalizeObject(source.preferences)
  };
}

export const pantryChefAdapter: SyncAdapter<PantryChefData> = {
  appId: 'pantry-chef',
  schemaVersion: 1,
  createDefaultData() {
    return normalizePantryChefData({});
  },
  normalizeData(input) {
    return normalizePantryChefData(input);
  },
  merge(localData, remoteData) {
    const local = normalizePantryChefData(localData);
    const remote = normalizePantryChefData(remoteData);

    return {
      pantry: mergeCollection(local.pantry, remote.pantry),
      stapleSeasonings: mergeCollection(local.stapleSeasonings, remote.stapleSeasonings),
      shoppingList: mergeCollection(local.shoppingList, remote.shoppingList),
      preferences: {
        ...remote.preferences,
        ...local.preferences
      }
    };
  },
  getHash(data) {
    return createHash(data);
  },
  getStorageKeys() {
    return {
      dataKey: 'pantryChefData',
      metadataKey: 'pantryChefSyncState',
      providerConfigKey: 'pantryChefSyncConfig'
    };
  },
  getDefaultRemotePath() {
    return '/apps/pantry-chef/data.json';
  }
};
