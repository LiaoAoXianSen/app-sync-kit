import { habitAppAdapter } from '@app-sync-kit/adapter-habit-app';
import { lifePlanAdapter } from '@app-sync-kit/adapter-life-plan';
import { pantryChefAdapter } from '@app-sync-kit/adapter-pantry-chef';
import { wheelAppAdapter } from '@app-sync-kit/adapter-wheel-app';
import { createWebdavProvider, type WebdavProviderConfig, type WebdavProviderOptions } from '@app-sync-kit/provider-webdav';
import {
  createBrowserSyncStorage,
  SyncManager,
  type BrowserStorageOptions,
  type StorageLike,
  type SyncAdapter,
  type SyncManagerOptions
} from '@app-sync-kit/sync-core';

export { habitAppAdapter } from '@app-sync-kit/adapter-habit-app';
export { lifePlanAdapter } from '@app-sync-kit/adapter-life-plan';
export { pantryChefAdapter } from '@app-sync-kit/adapter-pantry-chef';
export { wheelAppAdapter } from '@app-sync-kit/adapter-wheel-app';
export { createWebdavProvider } from '@app-sync-kit/provider-webdav';
export { createBrowserSyncStorage, createHash, SyncManager } from '@app-sync-kit/sync-core';
export type { HabitSnapshot } from '@app-sync-kit/adapter-habit-app';
export type { LifePlanData, LifePlanItem } from '@app-sync-kit/adapter-life-plan';
export type { PantryChefData, PantryChefItem } from '@app-sync-kit/adapter-pantry-chef';
export type { WheelSnapshot } from '@app-sync-kit/adapter-wheel-app';
export type { WebdavProviderConfig, WebdavProviderOptions } from '@app-sync-kit/provider-webdav';
export type {
  BrowserStorageOptions,
  RemoteDocument,
  RemoteDocumentEnvelope,
  StorageLike,
  SyncAdapter,
  SyncDirection,
  SyncManagerOptions,
  SyncMetadata,
  SyncProvider,
  SyncRunResult,
  SyncStorage,
  SyncStorageKeys
} from '@app-sync-kit/sync-core';

export interface BrowserWebdavSyncOptions<TData> {
  adapter: SyncAdapter<TData>;
  endpoint: string;
  remotePath?: string;
  writeMode?: WebdavProviderConfig['writeMode'];
  localStorage?: StorageLike;
  fetchImpl?: WebdavProviderOptions['fetchImpl'];
  now?: SyncManagerOptions<TData, WebdavProviderConfig>['now'];
}

export function createBrowserWebdavSyncManager<TData>(
  options: BrowserWebdavSyncOptions<TData>
): SyncManager<TData, WebdavProviderConfig> {
  const storageKeys = options.adapter.getStorageKeys();
  const storageOptions: BrowserStorageOptions = {
    ...storageKeys,
    localStorage: options.localStorage
  };

  return new SyncManager<TData, WebdavProviderConfig>({
    adapter: options.adapter,
    provider: createWebdavProvider<TData>({ fetchImpl: options.fetchImpl }),
    storage: createBrowserSyncStorage<TData, WebdavProviderConfig>(storageOptions),
    defaultProviderConfig: {
      endpoint: options.endpoint,
      remotePath: options.remotePath ?? options.adapter.getDefaultRemotePath(),
      writeMode: options.writeMode ?? 'legacy-raw-data'
    },
    now: options.now
  });
}

export const adapters = {
  habitApp: habitAppAdapter,
  lifePlan: lifePlanAdapter,
  pantryChef: pantryChefAdapter,
  wheelApp: wheelAppAdapter
};
