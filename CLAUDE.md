# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Local dev server with live reload
npm run dev          # wrangler dev

# Deploy to Cloudflare
npm run deploy       # wrangler deploy

# Initialize D1 database tables
npx wrangler d1 execute upload-db --file=schema.sql

# Set an API key in KV
npx wrangler kv:key put --namespace-id=<KV_ID> "sk-your-key" "active"

# Create R2 bucket, D1 database, or KV namespace
npx wrangler r2 bucket create upload-files
npx wrangler d1 create upload-db
npx wrangler kv:namespace create API_KEYS
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
- **One-time download**: After streaming the file from R2 to the client, `download.ts` schedules a `ctx.waitUntil()` callback that deletes the file from R2 and its metadata row from D1.
- **24-hour auto-expiry**: The `upload.ts` sets `expires_at` to now + 24h. `cleanup.ts` runs on a cron schedule (`0 * * * *`) to delete expired records from both R2 and D1.
- **Auth**: Every route except `/health` requires an `Authorization: Bearer sk-xxx` header. Tokens are validated by looking them up in KV (existence check only).

### File metadata schema (D1)
`schema.sql` defines a `files` table with columns: key (PK), filename, size, content_type, created_at, expires_at, downloaded (boolean flag, currently unused in cleanup logic — expired records are found by timestamp only).

### Key points about the code
- File keys are 4-character alphanumeric (`[a-z0-9]{4}`), generated with collision retry, with a timestamp-based fallback.
- Max file size: 100MB (enforced in `upload.ts`).
- R2 bucket binding: `FILES_BUCKET`, D1 binding: `DB`, KV binding: `API_KEYS` — all defined in `wrangler.toml` and typed in `src/types.ts`.
- The Worker uses ES2022 modules format with `@cloudflare/workers-types` for type checking.
- No test framework is currently configured.

## Setting up a new deployment

1. Run `npm install`
2. Create R2 bucket (`wrangler r2 bucket create upload-files`)
3. Create D1 database (`wrangler d1 create upload-db`) and copy the `database_id` into `wrangler.toml`
4. Run the schema (`wrangler d1 execute upload-db --file=schema.sql`)
5. Create KV namespace (`wrangler kv:namespace create API_KEYS`) and copy the `id` into `wrangler.toml`
6. Insert an API key into KV
7. Deploy with `npm run deploy`