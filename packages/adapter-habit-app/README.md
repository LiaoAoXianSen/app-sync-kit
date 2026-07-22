# @app-sync-kit/adapter-habit-app

Habit app sync adapter for `/apps/habit-app/data.json`.

This package defines the shared habit snapshot used by:

- `life-plan-site` PC habit center
- `yuanqidaka` Android habit app via Kotlin mapper
- future habit clients

The Cloudflare Worker remains generic JSON storage. Business normalization, tombstones, merge keys, ledger idempotency, and hash generation live in this adapter/client layer.

See `../../docs/habit-app-schema.md` for the protocol contract.
