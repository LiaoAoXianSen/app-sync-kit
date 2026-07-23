import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const bundlePath = new URL('../packages/browser/dist/app-sync-kit.browser.js', import.meta.url);
assert.ok(existsSync(bundlePath), 'Browser bundle missing. Run npm run build first.');

const {
  SyncManager,
  habitAppAdapter
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
    remotePath: '/apps/habit-app/data.json',
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
          appId: 'habit-app',
          schemaVersion: 1,
          updatedAt: new Date().toISOString(),
          data: structuredClone(remote)
        },
        hash: habitAppAdapter.getHash(remote),
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
        hash: habitAppAdapter.getHash(remote),
        etag
      };
    },
    async healthCheck() {}
  };
}

const empty = habitAppAdapter.createDefaultData();

function habit(id, updatedAt, title = id) {
  return {
    id,
    title,
    description: '',
    status: 'active',
    sort: 0,
    icon: '✅',
    color: '#6EA6E4',
    groupId: 'default',
    rewardAmount: 1,
    rewardCurrencyId: 'default',
    fineAmount: 0,
    fineCurrencyId: 'default',
    repeatUnit: 'daily',
    weekdays: [],
    reminderTimes: [],
    targetCount: 0,
    targetRewardAmount: 0,
    requiredCountPerDay: 1,
    taskDurationSec: 0,
    createdAt: updatedAt,
    updatedAt
  };
}

function record(id, habitId, type, recordDate, updatedAt, extra = {}) {
  return {
    id,
    habitId,
    recordTime: `${recordDate}T08:00:00.000Z`,
    recordDate,
    amount: 1,
    currencyId: 'default',
    type,
    note: '',
    createdAt: updatedAt,
    updatedAt,
    ...extra
  };
}

function ledger(id, type, sourceId, amount, date, updatedAt, extra = {}) {
  return {
    id,
    type,
    amount,
    currencyId: 'default',
    date,
    sourceId,
    note: '',
    createdAt: updatedAt,
    updatedAt,
    ...extra
  };
}

const remoteOnly = {
  ...empty,
  habits: [habit('h-remote', '2026-01-01T00:00:00.000Z', '云端习惯')]
};

const seedLocal = {
  ...empty,
  habits: [habit('h-seed', '2026-01-02T00:00:00.000Z', '本地种子习惯')]
};

// 1) Clean first sync downloads remote and never uploads seed.
{
  const storage = createMemoryStorage(seedLocal, { dirty: false, lastRemoteHash: '' });
  const provider = createProvider(remoteOnly);
  const manager = new SyncManager({
    adapter: habitAppAdapter,
    provider,
    storage,
    defaultProviderConfig: {
      endpoint: 'https://example.test',
      remotePath: '/apps/habit-app/data.json',
      writeMode: 'legacy-raw-data'
    }
  });

  const result = await manager.sync('both');
  assert.equal(result.action, 'downloaded', 'clean first sync should download remote, not push seed');
  assert.equal(provider.putCount, 0, 'clean first sync must not upload');
  assert.deepEqual(result.data.habits.map((entry) => entry.id), ['h-remote']);
  assert.equal(provider.remote.habits[0].id, 'h-remote');
}

// 2) Tombstones prevent habit resurrection.
{
  const local = {
    ...empty,
    habits: [],
    deletedItems: [{ collection: 'habits', id: 'h-remote', deletedAt: '2026-02-01T00:00:00.000Z' }]
  };
  const merged = habitAppAdapter.merge(local, remoteOnly);
  assert.equal(
    merged.habits.some((entry) => entry.id === 'h-remote'),
    false,
    'tombstoned habit must not resurrect'
  );
  assert.ok(merged.deletedItems.some((item) => item.id === 'h-remote'));
}

// 3) Entity updated after tombstone can intentionally restore.
{
  const local = {
    ...empty,
    habits: [],
    deletedItems: [{ collection: 'habits', id: 'h-remote', deletedAt: '2026-02-01T00:00:00.000Z' }]
  };
  const restoredRemote = {
    ...empty,
    habits: [habit('h-remote', '2026-03-01T00:00:00.000Z', '恢复习惯')]
  };
  const merged = habitAppAdapter.merge(local, restoredRemote);
  assert.equal(merged.habits.some((entry) => entry.id === 'h-remote'), true, 'newer habit should restore after tombstone');
}

// 4) Both sides changed => merge then upload, keep both additions, send If-Match.
{
  const local = {
    ...empty,
    habits: [habit('h-local', '2026-03-01T00:00:00.000Z', '本地新增')]
  };
  const storage = createMemoryStorage(local, {
    dirty: true,
    lastRemoteHash: habitAppAdapter.getHash(remoteOnly),
    lastRemoteEtag: '"remote-v1"'
  });
  const divergedRemote = {
    ...remoteOnly,
    habits: [
      ...remoteOnly.habits,
      habit('h-remote-new', '2026-03-02T00:00:00.000Z', '云端新增')
    ]
  };
  const provider = createProvider(divergedRemote, { etag: '"remote-v2"' });
  const manager = new SyncManager({
    adapter: habitAppAdapter,
    provider,
    storage,
    defaultProviderConfig: {
      endpoint: 'https://example.test',
      remotePath: '/apps/habit-app/data.json',
      writeMode: 'legacy-raw-data'
    }
  });
  const result = await manager.sync('both');
  assert.equal(result.action, 'merged-then-uploaded');
  const ids = result.data.habits.map((entry) => entry.id);
  assert.ok(ids.includes('h-local'));
  assert.ok(ids.includes('h-remote-new'));
  assert.ok(provider.puts.some((entry) => entry.ifMatch === '"remote-v2"'));
}

// 5) Ledger idempotency prevents double balance.
{
  const local = {
    ...empty,
    habitLedger: [ledger('ledger-local', 'checkin', 'record-1', 1, '2026-04-01', '2026-04-01T08:00:00.000Z')]
  };
  const remote = {
    ...empty,
    habitLedger: [ledger('ledger-remote', 'checkin', 'record-1', 1, '2026-04-01', '2026-04-01T09:00:00.000Z')]
  };
  const merged = habitAppAdapter.merge(local, remote);
  assert.equal(merged.habitLedger.length, 1, 'same type/sourceId/currency ledger should merge to one entry');
  assert.equal(merged.habitLedger.reduce((sum, entry) => sum + entry.amount, 0), 1, 'ledger amount should count once');
}

// 6) Milestone claim idempotency.
{
  const baseClaim = {
    habitId: 'h1',
    milestoneId: 'm1',
    cycleStartDate: '2026-04-01',
    achievedDays: 7,
    rewardAmount: 10,
    currencyId: 'default',
    claimedAt: '2026-04-07T08:00:00.000Z',
    createdAt: '2026-04-07T08:00:00.000Z',
    updatedAt: '2026-04-07T08:00:00.000Z'
  };
  const sourceId = 'claim:h1:m1:2026-04-01:7:default';
  const local = {
    ...empty,
    habitMilestoneClaims: [{ id: 'claim-local', ...baseClaim }],
    habitLedger: [ledger('claim-ledger-local', 'streak_reward', sourceId, 10, '2026-04-07', '2026-04-07T08:00:00.000Z')]
  };
  const remote = {
    ...empty,
    habitMilestoneClaims: [{ id: 'claim-remote', ...baseClaim, updatedAt: '2026-04-07T09:00:00.000Z' }],
    habitLedger: [ledger('claim-ledger-remote', 'streak_reward', sourceId, 10, '2026-04-07', '2026-04-07T09:00:00.000Z')]
  };
  const merged = habitAppAdapter.merge(local, remote);
  assert.equal(merged.habitMilestoneClaims.length, 1, 'same logical milestone claim should merge to one entry');
  assert.equal(merged.habitLedger.filter((entry) => entry.sourceId === sourceId).length, 1, 'claim ledger source should merge to one entry');
}

// 7) Reward redemption and fine append-only records survive concurrent additions.
{
  const local = {
    ...empty,
    habitRewardRecords: [{
      id: 'redeem-1',
      rewardId: 'reward-1',
      redeemedAt: '2026-05-01T08:00:00.000Z',
      amount: 5,
      currencyId: 'default',
      note: '',
      createdAt: '2026-05-01T08:00:00.000Z',
      updatedAt: '2026-05-01T08:00:00.000Z'
    }],
    habitLedger: [ledger('ledger-redeem-1', 'reward_redeem', 'redeem-1', -5, '2026-05-01', '2026-05-01T08:00:00.000Z')]
  };
  const remote = {
    ...empty,
    habitFineRecords: [{
      id: 'fine-1',
      habitId: 'h1',
      finedAt: '2026-05-01T09:00:00.000Z',
      amount: 2,
      currencyId: 'default',
      reason: 'missed',
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z'
    }],
    habitLedger: [ledger('ledger-fine-1', 'fine', 'fine-1', -2, '2026-05-01', '2026-05-01T09:00:00.000Z')]
  };
  const merged = habitAppAdapter.merge(local, remote);
  assert.equal(merged.habitRewardRecords.length, 1);
  assert.equal(merged.habitFineRecords.length, 1);
  assert.equal(merged.habitLedger.length, 2);
}

// 8) Overdue event logical key merge prefers terminal status.
{
  const local = {
    ...empty,
    habitOverdueEvents: [{
      id: 'overdue-local',
      habitId: 'h1',
      dueDate: '2026-07-01',
      requiredCount: 1,
      observedCount: 0,
      missingCount: 1,
      fineAmount: 1,
      fineCurrencyId: 'default',
      status: 'pending',
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z'
    }]
  };
  const remote = {
    ...empty,
    habitOverdueEvents: [{
      id: 'overdue-remote',
      habitId: 'h1',
      dueDate: '2026-07-01',
      requiredCount: 1,
      observedCount: 0,
      missingCount: 1,
      fineAmount: 1,
      fineCurrencyId: 'default',
      status: 'fined',
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z'
    }]
  };
  const merged = habitAppAdapter.merge(local, remote);
  assert.equal(merged.habitOverdueEvents.length, 1);
  assert.equal(merged.habitOverdueEvents[0].status, 'fined');
}

// 9) Deleted default currency/group are protected.
{
  const local = {
    ...empty,
    habitGroups: [],
    habitCurrencies: [],
    deletedItems: [
      { collection: 'habitGroups', id: 'default', deletedAt: '2026-08-01T00:00:00.000Z' },
      { collection: 'habitCurrencies', id: 'default', deletedAt: '2026-08-01T00:00:00.000Z' }
    ]
  };
  const merged = habitAppAdapter.merge(local, empty);
  assert.ok(merged.habitGroups.some((entry) => entry.id === 'default'));
  assert.ok(merged.habitCurrencies.some((entry) => entry.id === 'default'));
  assert.equal(merged.deletedItems.some((item) => item.id === 'default'), false);
}

// 10) Hash stability for reordered duplicate tombstones.
{
  const first = {
    ...empty,
    deletedItems: [
      { collection: 'habits', id: 'h1', deletedAt: '2026-09-01T00:00:00.000Z' },
      { collection: 'habits', id: 'h1', deletedAt: '2026-08-01T00:00:00.000Z' },
      { collection: 'habitRewards', id: 'r1', deletedAt: '2026-09-02T00:00:00.000Z' }
    ]
  };
  const second = {
    ...empty,
    deletedItems: [...first.deletedItems].reverse()
  };
  assert.equal(habitAppAdapter.getHash(first), habitAppAdapter.getHash(second), 'duplicate tombstone order should not change hash');
}

// 11) Normalization preserves yuanqidaka completion/streak semantics.
{
  const normalized = habitAppAdapter.normalizeData({
    ...empty,
    habitRecords: [
      record('normal-1', 'h1', 'normal', '2026-10-01', '2026-10-01T08:00:00.000Z'),
      record('makeup-1', 'h1', 'makeup', '2026-10-02', '2026-10-03T08:00:00.000Z'),
      record('exempt-1', 'h1', 'exempt', '2026-10-03', '2026-10-03T23:59:58.000Z'),
      record('break-1', 'h1', 'overdue_break', '2026-10-04', '2026-10-04T23:59:59.000Z')
    ]
  });
  const flags = Object.fromEntries(normalized.habitRecords.map((entry) => [entry.type, [entry.countsAsCompletion, entry.countsForStreak]]));
  assert.deepEqual(flags.normal, [true, true]);
  assert.deepEqual(flags.makeup, [true, true]);
  assert.deepEqual(flags.exempt, [false, true]);
  assert.deepEqual(flags.overdue_break, [false, false]);
}

// 12) Transport-only fields cannot create a perpetual remote-change loop.
{
  const canonicalRemote = {
    ...empty,
    habits: [habit('h-canonical', '2026-11-01T08:00:00.000Z', '规范习惯')]
  };
  const transportRemote = {
    ...canonicalRemote,
    schemaVersion: 1,
    generatedAt: '2026-11-01T09:00:00.000Z',
    habits: canonicalRemote.habits.map((entry) => ({ ...entry, legacyOnlyNote: 'ignored by adapter' }))
  };
  const provider = createProvider(transportRemote);
  const originalPull = provider.pull.bind(provider);
  provider.pull = async () => {
    const envelope = await originalPull();
    return envelope ? { ...envelope, hash: 'transport-hash-that-must-not-drive-sync' } : null;
  };
  const storage = createMemoryStorage(empty, { dirty: false, lastRemoteHash: '' });
  const manager = new SyncManager({
    adapter: habitAppAdapter,
    provider,
    storage,
    defaultProviderConfig: {
      endpoint: 'https://example.test',
      remotePath: '/apps/habit-app/data.json',
      writeMode: 'legacy-raw-data'
    }
  });

  const first = await manager.sync('both');
  assert.equal(first.action, 'downloaded');
  assert.equal(first.metadata.lastRemoteHash, habitAppAdapter.getHash(transportRemote));
  const second = await manager.sync('both');
  assert.equal(second.action, 'idle', 'normalized remote content should be stable on the next sync');
  assert.equal(provider.putCount, 0, 'ignored transport fields must not trigger a rewrite');
}

console.log('habit sync safety checks passed');
