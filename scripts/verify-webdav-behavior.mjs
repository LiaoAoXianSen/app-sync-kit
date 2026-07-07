import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const bundlePath = '../packages/browser/dist/app-sync-kit.browser.js';
const absoluteBundlePath = new URL(bundlePath, import.meta.url);

assert.ok(
  existsSync(absoluteBundlePath),
  'Browser bundle is missing. Run `npm run build` before WebDAV behavior verification.'
);

const { createWebdavProvider } = await import(bundlePath);
const calls = [];
const fetchImpl = async (url, init = {}) => {
  calls.push({
    url,
    method: init.method,
    body: init.body ?? null
  });

  return new Response('', { status: init.method === 'MKCOL' ? 201 : 200 });
};

const provider = createWebdavProvider({ fetchImpl });
await provider.push(
  {
    endpoint: 'https://example.test/dav/',
    remotePath: '/apps/pantry-chef/data.json',
    writeMode: 'legacy-raw-data'
  },
  {
    appId: 'pantry-chef',
    schemaVersion: 1,
    updatedAt: '2026-07-07T00:00:00.000Z',
    data: {
      pantry: [{ id: 'rice', name: 'Rice' }],
      stapleSeasonings: [],
      shoppingList: [],
      preferences: { theme: 'light' }
    }
  }
);

const sequence = calls.map((call) => `${call.method} ${new URL(call.url).pathname}`);
const putBody = JSON.parse(calls.at(-1).body);

assert.deepEqual(sequence, [
  'MKCOL /dav/apps',
  'MKCOL /dav/apps/pantry-chef',
  'PUT /dav/apps/pantry-chef/data.json'
]);
assert.deepEqual(Object.keys(putBody).sort(), ['pantry', 'preferences', 'shoppingList', 'stapleSeasonings']);
assert.equal(Boolean(putBody.appId || putBody.data), false);
assert.equal(putBody.pantry.length, 1);
assert.equal(putBody.preferences.theme, 'light');

console.log('WebDAV MKCOL and raw JSON behavior verified.');
