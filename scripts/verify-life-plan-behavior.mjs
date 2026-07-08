import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const bundlePath = '../packages/browser/dist/app-sync-kit.browser.js';
const absoluteBundlePath = new URL(bundlePath, import.meta.url);

assert.ok(
  existsSync(absoluteBundlePath),
  'Browser bundle is missing. Run `npm run build` before life-plan behavior verification.'
);

const { adapters } = await import(bundlePath);
const { lifePlan } = adapters;

const staleStamp = '2026-07-07T10:00:00';
const freshStamp = '2026-07-08T10:00:00';

const merged = lifePlan.merge(
  lifePlan.normalizeData({
    records: [
      {
        id: 'diary-prefix',
        type: '日记',
        title: '日记',
        content: '今天完成了同步修复，并记录了更多细节。',
        updatedAt: freshStamp
      },
      {
        id: 'diary-conflict',
        type: '日记',
        title: '分歧日记',
        content: '本地版本',
        updatedAt: freshStamp
      }
    ],
    todos: [],
    habits: [],
    checkins: [],
    habitPointLedger: [
      {
        type: 'checkin',
        sourceId: 'checkin-1',
        currency: '金币',
        amount: 3,
        updatedAt: freshStamp
      }
    ],
    habitRewards: [],
    habitCurrencies: [{ id: 'coin', name: '金币', updatedAt: freshStamp }],
    templates: [],
    goals: [],
    materials: [],
    wheels: [{ id: 'wheel-main', mode: 'normal', updatedAt: freshStamp, items: [] }],
    wheelTags: [],
    wheelLibraryItems: [],
    wheelHistory: [],
    deletedItems: [
      { collection: 'todos', id: 'deleted-todo', deletedAt: freshStamp },
      { collection: 'wheelItems', id: 'deleted-wheel-item', deletedAt: freshStamp, wheelId: 'wheel-main' }
    ]
  }),
  lifePlan.normalizeData({
    records: [
      {
        id: 'diary-prefix',
        type: '日记',
        title: '日记',
        content: '今天完成了同步修复',
        updatedAt: staleStamp
      },
      {
        id: 'diary-conflict',
        type: '日记',
        title: '分歧日记',
        content: '云端版本',
        updatedAt: staleStamp
      }
    ],
    todos: [{ id: 'deleted-todo', text: '旧待办', updatedAt: staleStamp }],
    habits: [],
    checkins: [],
    habitPointLedger: [
      {
        type: 'checkin',
        sourceId: 'checkin-1',
        currency: '金币',
        amount: 1,
        updatedAt: staleStamp
      }
    ],
    habitRewards: [],
    habitCurrencies: [],
    templates: [],
    goals: [],
    materials: [],
    wheels: [
      {
        id: 'wheel-main',
        mode: 'normal',
        updatedAt: staleStamp,
        items: [{ id: 'deleted-wheel-item', name: '旧选项', updatedAt: staleStamp }]
      }
    ],
    wheelTags: [],
    wheelLibraryItems: [],
    wheelHistory: [],
    deletedItems: []
  })
);

const prefixDiary = merged.records.find((record) => record.id === 'diary-prefix');
const conflictDiary = merged.records.find((record) => record.id === 'diary-conflict');
const conflictCopy = merged.records.find((record) => record.conflictOf === 'diary-conflict');
const ledger = merged.habitPointLedger.find((item) => item.sourceId === 'checkin-1');

assert.equal(lifePlan.getDefaultRemotePath(), '/life-plan.json');
assert.equal(prefixDiary.content.includes('更多细节'), true);
assert.equal(conflictDiary.content, '本地版本');
assert.equal(conflictCopy.content, '云端版本');
assert.equal(merged.todos.length, 0);
assert.equal(merged.wheels[0].items.length, 0);
assert.equal(ledger.amount, 3);
assert.equal(merged.habitCurrencies.length, 1);
assert.equal(
  merged.deletedItems.some((item) => item.collection === 'wheelItems' && item.id === 'deleted-wheel-item'),
  true
);

console.log('Life-plan adapter behavior verified.');
