import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const bundlePath = '../packages/browser/dist/app-sync-kit.browser.js';
const absoluteBundlePath = new URL(bundlePath, import.meta.url);

assert.ok(
  existsSync(absoluteBundlePath),
  'Browser bundle is missing. Run `npm run build` before behavior verification.'
);

const kit = await import(bundlePath);
const adapterKeys = Object.keys(kit.adapters).sort();
const pantryDefaultKeys = Object.keys(kit.adapters.pantryChef.createDefaultData()).sort();
const pantryNormalizedKeys = Object.keys(
  kit.adapters.pantryChef.normalizeData({
    pantry: [],
    recipes: [{ id: 'seed-recipe' }]
  })
).sort();

assert.equal(typeof kit.createBrowserWebdavSyncManager, 'function');
assert.equal(typeof kit.createWebdavProvider, 'function');
assert.deepEqual(adapterKeys, ['habitApp', 'lifePlan', 'pantryChef', 'wheelApp']);
assert.equal(kit.adapters.habitApp.getDefaultRemotePath(), '/apps/habit-app/data.json');
assert.equal(kit.habitAppAdapter.getDefaultRemotePath(), '/apps/habit-app/data.json');
assert.equal(kit.adapters.pantryChef.getDefaultRemotePath(), '/apps/pantry-chef/data.json');
assert.deepEqual(pantryDefaultKeys, ['pantry', 'preferences', 'shoppingList', 'stapleSeasonings']);
assert.deepEqual(pantryNormalizedKeys, ['pantry', 'preferences', 'shoppingList', 'stapleSeasonings']);

const manager = kit.createBrowserWebdavSyncManager({
  adapter: kit.adapters.pantryChef,
  endpoint: 'https://example.test/dav/',
  localStorage: {
    getItem() {
      return null;
    },
    setItem() {}
  },
  async fetchImpl() {
    return new Response('', { status: 404 });
  }
});

assert.equal(manager.getProviderConfig().writeMode, 'legacy-raw-data');

console.log('Browser bundle behavior verified.');
