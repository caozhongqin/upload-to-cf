# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Local dev server with live reload
npm run dev          # wrangler dev

# Deploy to Cloudflare
npm run deploy       # wrangler deploy

# Type-check the project
npx tsc --noEmit

# Regenerate Worker types from wrangler.toml bindings
npx wrangler types

# Initialize D1 database tables
npx wrangler d1 execute upload-db --file=schema.sql

# Run a single SQL command against D1
npx wrangler d1 execute upload-db --command="SELECT * FROM files;"

# Set an API key in KV
npx wrangler kv:key put --namespace-id=<KV_ID> "API_KEY" "your-secret"

# Create R2 bucket, D1 database, or KV namespace
npx wrangler r2 bucket create upload-files
npx wrangler d1 create upload-db
npx wrangler kv:namespace create API_KEYS

# Tail live production logs
npx wrangler tail
```

## Project Overview

A pure backend file upload/download service built on Cloudflare Workers. Users upload files and get a 4-character key, then share the key so recipients can download the file once (it self-destructs after download or 24 hours).

**Tech stack:** Cloudflare Workers (API routing) + R2 (file storage) + D1/SQLite (metadata) + KV (API keys) + Cron Triggers (hourly cleanup).

## Architecture

The Worker has two entry points defined in `src/index.ts`:

- **`fetch()`** — handles HTTP routes for health check, upload, and download
- **`scheduled()`** — cron handler that runs hourly to purge expired files

### Request flow
```
Request → index.ts (router) → auth.ts (API key check via KV)
                              ├── /upload  POST → upload.ts  → R2 put + D1 insert
                              ├── /download/<key> GET → download.ts → R2 get + D1 delete (post-download)
                              └── /health  GET → 200 OK (no auth)
```

### Key behaviors
- **One-time download**: After streaming the file from R2 to the client, `download.ts` schedules a `ctx.waitUntil()` callback that deletes the file from R2 and its metadata row from D1. The response is returned before cleanup completes.
- **24-hour auto-expiry**: `upload.ts` sets `expires_at` to now + 24h. `cleanup.ts` runs on cron (`0 * * * *`) and deletes expired D1 rows and matching R2 objects.
- **Auth**: Every route except `/health` requires an `Authorization: Bearer <token>` header. `auth.ts` does a direct KV lookup for key `API_KEY` on every request — no caching layer.

### D1 schema (`schema.sql`)
The `files` table has columns: `key` (PK), `filename`, `size`, `content_type`, `created_at`, `expires_at`, `downloaded` (boolean, default 0).

**Notable nuance about `downloaded`:** The column is queried in `download.ts` (`WHERE ... AND downloaded = 0`) but is **never set to 1**. Instead, rows are deleted outright after download via `DELETE FROM files WHERE key = ?`. The `downloaded` column and its index (`idx_files_downloaded`) are effectively unused — only the `expires_at` index matters for the cleanup query. The column exists as a potential optimization if behavior were changed to soft-delete instead of hard-delete.

### Key code details
- **Key generation** (`upload.ts`): 4-character alphanumeric (`[a-z0-9]{4}`), with up to 10 collision-retry attempts against D1. Falls back to a timestamp-based key (`Date.now().toString(36).slice(-4)`) if all retries are exhausted.
- **Max file size**: 100MB (enforced via `fileBuffer.byteLength` check in `upload.ts`).
- **Error handling** (`download.ts`): If the D1 record exists but the R2 object is missing (inconsistent state), the D1 record is cleaned up and a 404 is returned.
- **Cleanup resilience** (`cleanup.ts`): Each expired file is deleted independently — a single failure doesn't abort the batch. Errors are logged per-file.
- **Auth format**: Accepts both `Bearer sk-xxx` and bare `sk-xxx` in the Authorization header.
- **Bindings**: `FILES_BUCKET` (R2), `DB` (D1), `API_KEYS` (KV) — defined in `wrangler.toml` and typed via `src/types.ts`.
- **Format**: ES2022 modules with `@cloudflare/workers-types` for type checking.
- **Tests**: No test framework is currently configured.

### Error response format
All error responses follow a uniform shape:
```json
{ "error": "Human-readable error message." }
```
HTTP status codes used: 400 (bad request), 401 (unauthorized), 404 (not found), 413 (file too large), and a catch-all 404 for unknown routes.

## Setting up a new deployment

1. Run `npm install`
2. Create R2 bucket (`wrangler r2 bucket create upload-files`)
3. Create D1 database (`wrangler d1 create upload-db`) and copy the `database_id` into `wrangler.toml`
4. Run the schema (`wrangler d1 execute upload-db --file=schema.sql`)
5. Regenerate types: `npx wrangler types`
6. Create KV namespace (`wrangler kv:namespace create API_KEYS`) and copy the `id` into `wrangler.toml`
7. Insert an API key into KV (key name: `API_KEY`)
8. Deploy with `npm run deploy`