import type { SyncMetadata, SyncStorage } from './types';

const DEFAULT_METADATA: SyncMetadata = {
  dirty: false,
  lastLocalHash: '',
  lastRemoteHash: '',
  lastSyncAt: null,
  lastPullAt: null,
  lastPushAt: null,
  lastConflictAt: null
};

function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  const raw = storage.getItem(key);
  if (!raw) return fallback;

  try {
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BrowserStorageOptions {
  dataKey: string;
  metadataKey: string;
  providerConfigKey: string;
  localStorage?: StorageLike;
}

export function createBrowserSyncStorage<TData, TProviderConfig>(
  options: BrowserStorageOptions
): SyncStorage<TData, TProviderConfig> {
  const storage = options.localStorage ?? window.localStorage;

  return {
    loadData(defaultData) {
      return readJson(storage, options.dataKey, defaultData);
    },
    saveData(data) {
      storage.setItem(options.dataKey, JSON.stringify(data));
    },
    loadMetadata(defaultMetadata) {
      return readJson(storage, options.metadataKey, { ...DEFAULT_METADATA, ...defaultMetadata });
    },
    saveMetadata(metadata) {
      storage.setItem(options.metadataKey, JSON.stringify(metadata));
    },
    loadProviderConfig(defaultConfig) {
      return readJson(storage, options.providerConfigKey, defaultConfig);
    },
    saveProviderConfig(config) {
      storage.setItem(options.providerConfigKey, JSON.stringify(config));
    }
  };
}
