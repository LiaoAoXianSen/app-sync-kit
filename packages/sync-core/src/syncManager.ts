import { createHash } from './hash';
import type {
  RemoteDocument,
  SyncAdapter,
  SyncDirection,
  SyncManagerOptions,
  SyncMetadata,
  SyncRunResult
} from './types';

const DEFAULT_METADATA: SyncMetadata = {
  dirty: false,
  lastLocalHash: '',
  lastRemoteHash: '',
  lastSyncAt: null,
  lastPullAt: null,
  lastPushAt: null,
  lastConflictAt: null
};

export class SyncManager<TData, TProviderConfig> {
  private readonly adapter: SyncAdapter<TData>;
  private readonly provider;
  private readonly storage;
  private readonly defaultProviderConfig: TProviderConfig;
  private readonly now: () => Date;

  constructor(options: SyncManagerOptions<TData, TProviderConfig>) {
    this.adapter = options.adapter;
    this.provider = options.provider;
    this.storage = options.storage;
    this.defaultProviderConfig = options.defaultProviderConfig;
    this.now = options.now ?? (() => new Date());
  }

  loadData(): TData {
    const defaultData = this.adapter.createDefaultData();
    const data = this.storage.loadData(defaultData);
    return this.adapter.normalizeData(data);
  }

  saveData(data: TData): TData {
    const normalized = this.adapter.normalizeData(data);
    this.storage.saveData(normalized);

    const metadata = this.getMetadata();
    const lastLocalHash = this.adapter.getHash(normalized);

    this.storage.saveMetadata({
      ...metadata,
      dirty: true,
      lastLocalHash
    });

    return normalized;
  }

  getProviderConfig(): TProviderConfig {
    return this.storage.loadProviderConfig(this.defaultProviderConfig);
  }

  saveProviderConfig(config: TProviderConfig): TProviderConfig {
    this.storage.saveProviderConfig(config);
    return config;
  }

  getMetadata(): SyncMetadata {
    const metadata = this.storage.loadMetadata(DEFAULT_METADATA);
    return {
      ...DEFAULT_METADATA,
      ...metadata
    };
  }

  async testConnection(): Promise<void> {
    const config = this.getProviderConfig();
    await this.provider.healthCheck?.(config);
  }

  async sync(direction: SyncDirection = 'both'): Promise<SyncRunResult<TData>> {
    const config = this.getProviderConfig();
    const localData = this.loadData();
    const metadata = this.getMetadata();
    const localHash = this.adapter.getHash(localData);
    const remoteEnvelope = await this.provider.pull(config);
    const remoteDocument = remoteEnvelope?.document ?? null;
    const remoteHash = remoteEnvelope?.hash ?? '';
    const localChanged =
      metadata.dirty ||
      (!!metadata.lastRemoteHash && localHash !== metadata.lastRemoteHash) ||
      !metadata.lastRemoteHash;
    const remoteChanged =
      !!remoteEnvelope &&
      !!metadata.lastRemoteHash &&
      remoteHash !== metadata.lastRemoteHash;

    if (direction === 'up') {
      return this.pushCurrentData(config, localData, metadata, localHash, remoteDocument, remoteHash);
    }

    if (direction === 'down') {
      return this.pullRemoteData(localData, metadata, localHash, remoteDocument, remoteHash);
    }

    if (!remoteDocument) {
      return this.pushCurrentData(config, localData, metadata, localHash, null, '');
    }

    if (!localChanged && !remoteChanged) {
      const nextMetadata = {
        ...metadata,
        lastPullAt: this.nowIso()
      };
      this.storage.saveMetadata(nextMetadata);

      return {
        action: 'idle',
        data: localData,
        metadata: nextMetadata,
        document: remoteDocument
      };
    }

    if (!localChanged) {
      return this.pullRemoteData(localData, metadata, localHash, remoteDocument, remoteHash);
    }

    if (!remoteChanged) {
      return this.pushCurrentData(config, localData, metadata, localHash, remoteDocument, remoteHash);
    }

    const mergedData = this.adapter.merge(localData, remoteDocument.data);
    const mergedHash = this.adapter.getHash(mergedData);
    this.storage.saveData(mergedData);

    const pushed = await this.provider.push(config, this.createDocument(mergedData));
    const nextMetadata = {
      ...metadata,
      dirty: false,
      lastLocalHash: mergedHash,
      lastRemoteHash: pushed.hash,
      lastPushAt: this.nowIso(),
      lastSyncAt: this.nowIso(),
      lastConflictAt: this.nowIso()
    };
    this.storage.saveMetadata(nextMetadata);

    return {
      action: 'merged-then-uploaded',
      data: mergedData,
      metadata: nextMetadata,
      document: pushed.document
    };
  }

  private async pullRemoteData(
    localData: TData,
    metadata: SyncMetadata,
    localHash: string,
    remoteDocument: RemoteDocument<TData> | null,
    remoteHash: string
  ): Promise<SyncRunResult<TData>> {
    if (!remoteDocument) {
      return {
        action: 'idle',
        data: localData,
        metadata,
        document: null
      };
    }

    const shouldMerge = metadata.dirty && localHash !== remoteHash;
    const nextData = shouldMerge ? this.adapter.merge(localData, remoteDocument.data) : remoteDocument.data;
    const nextHash = this.adapter.getHash(nextData);
    this.storage.saveData(nextData);

    const nextMetadata = {
      ...metadata,
      dirty: shouldMerge,
      lastLocalHash: nextHash,
      lastRemoteHash: remoteHash,
      lastPullAt: this.nowIso(),
      lastSyncAt: shouldMerge ? metadata.lastSyncAt : this.nowIso(),
      lastConflictAt: shouldMerge ? this.nowIso() : metadata.lastConflictAt
    };
    this.storage.saveMetadata(nextMetadata);

    return {
      action: shouldMerge ? 'merged-locally' : 'downloaded',
      data: nextData,
      metadata: nextMetadata,
      document: remoteDocument
    };
  }

  private async pushCurrentData(
    config: TProviderConfig,
    localData: TData,
    metadata: SyncMetadata,
    localHash: string,
    remoteDocument: RemoteDocument<TData> | null,
    remoteHash: string
  ): Promise<SyncRunResult<TData>> {
    if (remoteDocument && remoteHash && remoteHash !== localHash && remoteHash !== metadata.lastRemoteHash) {
      const mergedData = this.adapter.merge(localData, remoteDocument.data);
      const mergedHash = this.adapter.getHash(mergedData);
      this.storage.saveData(mergedData);
      const pushed = await this.provider.push(config, this.createDocument(mergedData));
      const nextMetadata = {
        ...metadata,
        dirty: false,
        lastLocalHash: mergedHash,
        lastRemoteHash: pushed.hash,
        lastPushAt: this.nowIso(),
        lastSyncAt: this.nowIso(),
        lastConflictAt: this.nowIso()
      };
      this.storage.saveMetadata(nextMetadata);

      return {
        action: 'merged-then-uploaded',
        data: mergedData,
        metadata: nextMetadata,
        document: pushed.document
      };
    }

    const pushed = await this.provider.push(config, this.createDocument(localData));
    const nextMetadata = {
      ...metadata,
      dirty: false,
      lastLocalHash: localHash,
      lastRemoteHash: pushed.hash,
      lastPushAt: this.nowIso(),
      lastSyncAt: this.nowIso()
    };
    this.storage.saveMetadata(nextMetadata);

    return {
      action: remoteDocument ? 'uploaded' : 'bootstrapped-remote',
      data: localData,
      metadata: nextMetadata,
      document: pushed.document
    };
  }

  private createDocument(data: TData): RemoteDocument<TData> {
    return {
      appId: this.adapter.appId,
      schemaVersion: this.adapter.schemaVersion,
      updatedAt: this.nowIso(),
      data
    };
  }

  private nowIso(): string {
    return this.now().toISOString();
  }
}

export function getDefaultHash<TData>(adapter: SyncAdapter<TData>, data: TData): string {
  return adapter.getHash(data) || createHash(data);
}
