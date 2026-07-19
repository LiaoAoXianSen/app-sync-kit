import { createHash } from './hash';
import {
  isConditionalWriteConflict,
  type RemoteDocument,
  type RemoteDocumentEnvelope,
  type SyncAdapter,
  type SyncDirection,
  type SyncManagerOptions,
  type SyncMetadata,
  type SyncRunResult
} from './types';

const DEFAULT_METADATA: SyncMetadata = {
  dirty: false,
  lastLocalHash: '',
  lastRemoteHash: '',
  lastRemoteEtag: '',
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
      ...metadata,
      lastRemoteEtag: metadata.lastRemoteEtag || ''
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
    const remoteEtag = remoteEnvelope?.etag || '';

    // Align with life-plan-site: never treat "no baseline" as local-only change
    // when remote already exists. That was overwriting cloud with seed data.
    const localChanged =
      metadata.dirty ||
      (!!metadata.lastRemoteHash && localHash !== metadata.lastRemoteHash) ||
      (!metadata.lastRemoteHash && !!remoteDocument && localHash !== remoteHash);
    const remoteChanged =
      !!remoteDocument &&
      ((!!metadata.lastRemoteHash && remoteHash !== metadata.lastRemoteHash) ||
        (!metadata.lastRemoteHash && remoteHash !== localHash));

    if (direction === 'up') {
      return this.pushCurrentData(config, localData, metadata, localHash, remoteDocument, remoteHash, remoteEtag);
    }

    if (direction === 'down') {
      return this.pullRemoteData(localData, metadata, localHash, remoteDocument, remoteHash, remoteEtag);
    }

    if (!remoteDocument) {
      return this.pushCurrentData(config, localData, metadata, localHash, null, '', '');
    }

    // First contact with existing remote and no local dirty edits:
    // adopt cloud as source of truth (do not merge/push local seed data).
    if (!metadata.lastRemoteHash && !metadata.dirty) {
      if (localHash === remoteHash) {
        const nextMetadata = {
          ...metadata,
          dirty: false,
          lastLocalHash: localHash,
          lastRemoteHash: remoteHash,
          lastRemoteEtag: remoteEtag || metadata.lastRemoteEtag || '',
          lastPullAt: this.nowIso(),
          lastSyncAt: this.nowIso()
        };
        this.storage.saveMetadata(nextMetadata);
        return {
          action: 'idle',
          data: localData,
          metadata: nextMetadata,
          document: remoteDocument
        };
      }
      return this.pullRemoteData(localData, metadata, localHash, remoteDocument, remoteHash, remoteEtag);
    }

    if (!localChanged && !remoteChanged) {
      const nextMetadata = {
        ...metadata,
        lastRemoteHash: remoteHash || metadata.lastRemoteHash,
        lastRemoteEtag: remoteEtag || metadata.lastRemoteEtag || '',
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

    if (!localChanged && remoteChanged) {
      return this.pullRemoteData(localData, metadata, localHash, remoteDocument, remoteHash, remoteEtag);
    }

    if (localChanged && !remoteChanged) {
      return this.pushCurrentData(config, localData, metadata, localHash, remoteDocument, remoteHash, remoteEtag);
    }

    // Both sides changed (or first sync with different content): merge first.
    return this.mergeAndUpload(config, localData, remoteDocument, metadata, remoteHash, remoteEtag);
  }

  private async pullRemoteData(
    localData: TData,
    metadata: SyncMetadata,
    localHash: string,
    remoteDocument: RemoteDocument<TData> | null,
    remoteHash: string,
    remoteEtag = ''
  ): Promise<SyncRunResult<TData>> {
    if (!remoteDocument) {
      return {
        action: 'idle',
        data: localData,
        metadata,
        document: null
      };
    }

    // Only merge when local still has unsynced edits; otherwise adopt remote wholesale.
    const shouldMerge = metadata.dirty && localHash !== remoteHash;
    const nextData = shouldMerge ? this.adapter.merge(localData, remoteDocument.data) : remoteDocument.data;
    const nextHash = this.adapter.getHash(nextData);
    this.storage.saveData(nextData);

    const nextMetadata = {
      ...metadata,
      dirty: shouldMerge && nextHash !== remoteHash,
      lastLocalHash: nextHash,
      lastRemoteHash: remoteHash,
      lastRemoteEtag: remoteEtag || metadata.lastRemoteEtag || '',
      lastPullAt: this.nowIso(),
      lastSyncAt: shouldMerge && nextHash !== remoteHash ? metadata.lastSyncAt : this.nowIso(),
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
    remoteHash: string,
    remoteEtag = '',
    options: { retryOnConditionalConflict?: boolean } = {}
  ): Promise<SyncRunResult<TData>> {
    // Remote diverged from our last known baseline: merge before upload.
    if (remoteDocument && remoteHash && remoteHash !== localHash && remoteHash !== metadata.lastRemoteHash) {
      return this.mergeAndUpload(config, localData, remoteDocument, metadata, remoteHash, remoteEtag, options);
    }

    // First contact with different remote content during forced up: still merge.
    if (remoteDocument && !metadata.lastRemoteHash && remoteHash && remoteHash !== localHash) {
      return this.mergeAndUpload(config, localData, remoteDocument, metadata, remoteHash, remoteEtag, options);
    }

    try {
      const pushed = await this.provider.push(config, this.createDocument(localData), {
        ifMatch: remoteEtag || metadata.lastRemoteEtag || ''
      });
      const nextMetadata = {
        ...metadata,
        dirty: false,
        lastLocalHash: localHash,
        lastRemoteHash: pushed.hash,
        lastRemoteEtag: pushed.etag || remoteEtag || metadata.lastRemoteEtag || '',
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
    } catch (error) {
      if (
        options.retryOnConditionalConflict !== false &&
        isConditionalWriteConflict(error)
      ) {
        const latest = await this.provider.pull(config);
        if (!latest?.document) {
          throw error;
        }
        return this.mergeAndUpload(
          config,
          localData,
          latest.document,
          metadata,
          latest.hash,
          latest.etag || '',
          { retryOnConditionalConflict: false }
        );
      }
      throw error;
    }
  }

  private async mergeAndUpload(
    config: TProviderConfig,
    localData: TData,
    remoteDocument: RemoteDocument<TData>,
    metadata: SyncMetadata,
    remoteHash: string,
    remoteEtag = '',
    options: { retryOnConditionalConflict?: boolean } = {}
  ): Promise<SyncRunResult<TData>> {
    const mergedData = this.adapter.merge(localData, remoteDocument.data);
    const mergedHash = this.adapter.getHash(mergedData);
    this.storage.saveData(mergedData);

    try {
      const pushed = await this.provider.push(config, this.createDocument(mergedData), {
        ifMatch: remoteEtag || metadata.lastRemoteEtag || ''
      });
      const nextMetadata = {
        ...metadata,
        dirty: false,
        lastLocalHash: mergedHash,
        lastRemoteHash: pushed.hash,
        lastRemoteEtag: pushed.etag || remoteEtag || metadata.lastRemoteEtag || '',
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
    } catch (error) {
      if (
        options.retryOnConditionalConflict !== false &&
        isConditionalWriteConflict(error)
      ) {
        const latest = await this.provider.pull(config);
        if (!latest?.document) {
          throw error;
        }
        // Merge against the freshest remote, then upload once more without further retry.
        const rematched = this.adapter.merge(mergedData, latest.document.data);
        this.storage.saveData(rematched);
        const pushed = await this.provider.push(config, this.createDocument(rematched), {
          ifMatch: latest.etag || ''
        });
        const rematchedHash = this.adapter.getHash(rematched);
        const nextMetadata = {
          ...metadata,
          dirty: false,
          lastLocalHash: rematchedHash,
          lastRemoteHash: pushed.hash,
          lastRemoteEtag: pushed.etag || latest.etag || '',
          lastPushAt: this.nowIso(),
          lastSyncAt: this.nowIso(),
          lastConflictAt: this.nowIso()
        };
        this.storage.saveMetadata(nextMetadata);
        return {
          action: 'merged-then-uploaded',
          data: rematched,
          metadata: nextMetadata,
          document: pushed.document
        };
      }
      throw error;
    }
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
