import type { Env } from './types';

export interface LimitConfig {
  maxFileSizeMB: number | null;
  dailyUploadLimit: number | null;
  dailyDownloadLimit: number | null;
}

/**
 * Read rate-limit configuration from KV.
 * Returns null for any key that is missing, empty, or not a valid number.
 */
export async function getLimitConfig(env: Env): Promise<LimitConfig> {
  const [sizeStr, uploadStr, downloadStr] = await Promise.all([
    env.API_KEYS.get('CONFIG_LIMIT_FILE_SIZE_MB'),
    env.API_KEYS.get('CONFIG_LIMIT_DAILY_UPLOAD'),
    env.API_KEYS.get('CONFIG_LIMIT_DAILY_DOWNLOAD'),
  ]);

  return {
    maxFileSizeMB: parsePositiveInt(sizeStr),
    dailyUploadLimit: parsePositiveInt(uploadStr),
    dailyDownloadLimit: parsePositiveInt(downloadStr),
  };
}

/**
 * Check today's count for the given action type and increment it atomically.
 *
 * @returns `{ allowed: true }` if under limit; `{ allowed: false, current, limit }` if exceeded.
 *          On D1 error, fails open (`{ allowed: true }`) so storage issues don't block uploads.
 */
export async function checkAndIncrementDailyLimit(
  env: Env,
  actionType: 'upload' | 'download',
  limit: number,
): Promise<{ allowed: true } | { allowed: false; current: number; limit: number }> {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD' (UTC)

  try {
    // 1. Check current count
    const row = await env.DB.prepare(
      'SELECT count FROM daily_usage WHERE date = ? AND action_type = ?',
    )
      .bind(today, actionType)
      .first<{ count: number }>();

    const currentCount = row?.count ?? 0;

    if (currentCount >= limit) {
      return { allowed: false, current: currentCount, limit };
    }

    // 2. Increment (atomic upsert)
    await env.DB.prepare(
      `INSERT INTO daily_usage (date, action_type, count) VALUES (?, ?, 1)
       ON CONFLICT(date, action_type) DO UPDATE SET count = count + 1`,
    )
      .bind(today, actionType)
      .run();

    return { allowed: true };
  } catch (err) {
    // Fail open: if D1 has a hiccup, don't block the upload/download
    console.error(`Daily limit check failed for ${actionType}:`, err);
    return { allowed: true };
  }
}

function parsePositiveInt(value: string | null): number | null {
  if (value === null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
