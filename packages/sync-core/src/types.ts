export interface RemoteDocument<TData> {
  appId: string;
  schemaVersion: number;
  updatedAt: string;
  data: TData;
}

export interface RemoteDocumentEnvelope<TData> {
  document: RemoteDocument<TData>;
  hash: string;
  etag?: string;
}

export interface SyncPushOptions {
  ifMatch?: string;
  retryOnConditionalConflict?: boolean;
}

export interface SyncProvider<TData, TConfig = unknown> {
  pull(config: TConfig): Promise<RemoteDocumentEnvelope<TData> | null>;
  push(
    config: TConfig,
    document: RemoteDocument<TData>,
    options?: SyncPushOptions
  ): Promise<RemoteDocumentEnvelope<TData>>;
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
  lastRemoteEtag?: string;
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

export class SyncHttpError extends Error {
  status: number;
  method: string;
  etag: string;

  constructor(message: string, options: { status: number; method?: string; etag?: string } = { status: 0 }) {
    super(message);
    this.name = 'SyncHttpError';
    this.status = options.status;
    this.method = options.method || '';
    this.etag = options.etag || '';
  }
}

export function isConditionalWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = Number((error as { status?: number }).status || 0);
  return status === 412;
}
