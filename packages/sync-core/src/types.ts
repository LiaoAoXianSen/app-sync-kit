export interface RemoteDocument<TData> {
  appId: string;
  schemaVersion: number;
  updatedAt: string;
  data: TData;
}

export interface RemoteDocumentEnvelope<TData> {
  document: RemoteDocument<TData>;
  hash: string;
}

export interface SyncProvider<TData, TConfig = unknown> {
  pull(config: TConfig): Promise<RemoteDocumentEnvelope<TData> | null>;
  push(config: TConfig, document: RemoteDocument<TData>): Promise<RemoteDocumentEnvelope<TData>>;
  healthCheck?(config: TConfig): Promise<void>;
}

export interface SyncStorageKeys {
  dataKey: string;
  metadataKey: string;
  providerConfigKey: string;
}

export interface SyncMetadata {
  dirty: boolean;
  lastLocalHash: string;
  lastRemoteHash: string;
  lastSyncAt: string | null;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastConflictAt: string | null;
}

export interface SyncAdapter<TData> {
  appId: string;
  schemaVersion: number;
  createDefaultData(): TData;
  normalizeData(input: unknown): TData;
  merge(localData: TData, remoteData: TData): TData;
  getHash(data: TData): string;
  getStorageKeys(): SyncStorageKeys;
  getDefaultRemotePath(): string;
}

export interface SyncStorage<TData, TProviderConfig> {
  loadData(defaultData: TData): TData;
  saveData(data: TData): void;
  loadMetadata(defaultMetadata: SyncMetadata): SyncMetadata;
  saveMetadata(metadata: SyncMetadata): void;
  loadProviderConfig(defaultConfig: TProviderConfig): TProviderConfig;
  saveProviderConfig(config: TProviderConfig): void;
}

export type SyncDirection = 'up' | 'down' | 'both';

export interface SyncRunResult<TData> {
  action:
    | 'idle'
    | 'uploaded'
    | 'downloaded'
    | 'merged-then-uploaded'
    | 'merged-locally'
    | 'bootstrapped-remote';
  data: TData;
  metadata: SyncMetadata;
  document: RemoteDocument<TData> | null;
}

export interface SyncManagerOptions<TData, TProviderConfig> {
  adapter: SyncAdapter<TData>;
  provider: SyncProvider<TData, TProviderConfig>;
  storage: SyncStorage<TData, TProviderConfig>;
  defaultProviderConfig: TProviderConfig;
  now?: () => Date;
}
