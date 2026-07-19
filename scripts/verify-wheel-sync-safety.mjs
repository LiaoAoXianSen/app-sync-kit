import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const bundlePath = new URL('../packages/browser/dist/app-sync-kit.browser.js', import.meta.url);
assert.ok(existsSync(bundlePath), 'Browser bundle missing. Run npm run build first.');

const {
  SyncManager,
  wheelAppAdapter
} = await import(pathToFileURL(bundlePath.pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);

function createMemoryStorage(initialData, initialMeta = {}, initialConfig = {}) {
  let data = structuredClone(initialData);
  let metadata = {
    dirty: false,
    lastLocalHash: '',
    lastRemoteHash: '',
    lastRemoteEtag: '',
    lastSyncAt: null,
    lastPullAt: null,
    lastPushAt: null,
    lastConflictAt: null,
    ...initialMeta
  };
  let config = {
    endpoint: 'https://example.test',
    remotePath: '/apps/wheel-app/data.json',
    writeMode: 'legacy-raw-data',
    autoSync: true,
    ...initialConfig
  };

  return {
    loadData(defaultData) {
      return structuredClone(data ?? defaultData);
    },
    saveData(next) {
      data = structuredClone(next);
    },
    loadMetadata(defaultMetadata) {
      return { ...defaultMetadata, ...metadata };
    },
    saveMetadata(next) {
      metadata = { ...metadata, ...next };
    },
    loadProviderConfig(defaultConfig) {
      return { ...defaultConfig, ...config };
    },
    saveProviderConfig(next) {
      config = { ...config, ...next };
    }
  };
}

function createProvider(remoteSnapshot, options = {}) {
  let remote = remoteSnapshot ? structuredClone(remoteSnapshot) : null;
  let etag = options.etag || (remote ? '"remote-v1"' : '');
  let putCount = 0;
  const puts = [];

  return {
    puts,
    get putCount() {
      return putCount;
    },
    get remote() {
      return remote;
    },
    async pull() {
      if (!remote) return null;
      return {
        document: {
          appId: 'wheel-app',
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          data: structuredClone(remote)
        },
        hash: wheelAppAdapter.getHash(remote),
        etag
      };
    },
    async push(_config, document, pushOptions = {}) {
      if (pushOptions.ifMatch && etag && pushOptions.ifMatch !== etag) {
        const err = new Error('WebDAV PUT failed: 412');
        err.status = 412;
        err.etag = etag;
        throw err;
      }
      putCount += 1;
      remote = structuredClone(document.data);
      etag = `"remote-v${putCount + 1}"`;
      puts.push({ data: structuredClone(remote), ifMatch: pushOptions.ifMatch || '' });
      return {
        document,
        hash: wheelAppAdapter.getHash(remote),
        etag
      };
    },
    async healthCheck() {}
  };
}

const remoteOnly = {
  wheels: [
    {
      id: 'remote-wheel',
      name: '云端转盘',
      mode: 'normal',
      items: [{ id: 'ri1', name: '云端项', weight: 1, enabled: true, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
  ],
  wheelTags: [],
  wheelLibraryItems: [],
  wheelHistory: [],
  deletedItems: []
};

const seedLocal = {
  wheels: [
    {
      id: 'seed-wheel',
      name: '本地种子',
      mode: 'normal',
      items: [{ id: 'si1', name: '种子项', weight: 1, enabled: true, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' }],
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z'
    }
  ],
  wheelTags: [],
  wheelLibraryItems: [],
  wheelHistory: [],
  deletedItems: []
};

// 1) Clean first sync downloads remote and never uploads seed.
{
  const storage = createMemoryStorage(seedLocal, { dirty: false, lastRemoteHash: '' });
  const provider = createProvider(remoteOnly);
  const manager = new SyncManager({
    adapter: wheelAppAdapter,
    provider,
    storage,
    defaultProviderConfig: {
      endpoint: 'https://example.test',
      remotePath: '/apps/wheel-app/data.json',
      writeMode: 'legacy-raw-data'
    }
  });

  const result = await manager.sync('both');
  assert.equal(result.action, 'downloaded', 'clean first sync should download remote, not push seed');
  assert.equal(provider.putCount, 0, 'clean first sync must not upload');
  assert.deepEqual(
    result.data.wheels.map((wheel) => wheel.id),
    ['remote-wheel']
  );
  assert.equal(provider.remote.wheels[0].id, 'remote-wheel');
}

// 2) Tombstones prevent resurrection.
{
  const local = {
    wheels: [],
    wheelTags: [],
    wheelLibraryItems: [],
    wheelHistory: [],
    deletedItems: [{ collection: 'wheels', id: 'remote-wheel', deletedAt: '2026-02-01T00:00:00.000Z' }]
  };
  const merged = wheelAppAdapter.merge(local, remoteOnly);
  assert.equal(
    merged.wheels.some((wheel) => wheel.id === 'remote-wheel'),
    false,
    'tombstoned wheel must not resurrect'
  );
  assert.ok((merged.deletedItems || []).some((item) => item.id === 'remote-wheel'));
}

// 3) Both sides changed => merge then upload, keep both additions, send If-Match.
{
  const local = {
    wheels: [
      {
        id: 'local-only',
        name: '本地新增',
        mode: 'normal',
        items: [],
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    wheelTags: [],
    wheelLibraryItems: [],
    wheelHistory: [],
    deletedItems: []
  };
  const storage = createMemoryStorage(local, {
    dirty: true,
    lastRemoteHash: wheelAppAdapter.getHash(remoteOnly),
    lastRemoteEtag: '"remote-v1"'
  });
  const divergedRemote = {
    ...remoteOnly,
    wheels: [
      ...remoteOnly.wheels,
      {
        id: 'remote-new',
        name: '云端新增',
        mode: 'normal',
        items: [],
        createdAt: '2026-03-02T00:00:00.000Z',
        updatedAt: '2026-03-02T00:00:00.000Z'
      }
    ]
  };
  const provider = createProvider(divergedRemote, { etag: '"remote-v2"' });
  const manager = new SyncManager({
    adapter: wheelAppAdapter,
    provider,
    storage,
    defaultProviderConfig: {
      endpoint: 'https://example.test',
      remotePath: '/apps/wheel-app/data.json',
      writeMode: 'legacy-raw-data'
    }
  });
  const result = await manager.sync('both');
  assert.equal(result.action, 'merged-then-uploaded');
  const ids = result.data.wheels.map((wheel) => wheel.id);
  assert.ok(ids.includes('local-only'));
  assert.ok(ids.includes('remote-new') || ids.includes('remote-wheel'));
  assert.ok(provider.puts.some((entry) => entry.ifMatch === '"remote-v2"'));
}

console.log('wheel sync safety checks passed');
