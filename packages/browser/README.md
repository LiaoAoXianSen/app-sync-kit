# @app-sync-kit/browser

Browser entry for static apps.

Build outputs:

- `dist/index.js`: package ESM entry for bundlers or import maps.
- `dist/app-sync-kit.browser.js`: bundled browser ESM entry.
- `dist/app-sync-kit.browser.global.js`: bundled global entry exposed as `AppSyncKit`.

The helper `createBrowserWebdavSyncManager` defaults to `legacy-raw-data` so existing WebDAV JSON files remain compatible.
