import type { Env } from './types';

// Scheduled cleanup: delete expired files from R2 and D1
export async function handleCleanup(env: Env): Promise<void> {
  const now = new Date().toISOString();

  // Find all expired records
  const expiredRecords = await env.DB.prepare(
    'SELECT key FROM files WHERE expires_at < ?'
  )
    .bind(now)
    .all<{ key: string }>();

  if (!expiredRecords.results || expiredRecords.results.length === 0) {
    console.log('Cleanup: no expired files found.');
    return;
  }

  console.log(`Cleanup: found ${expiredRecords.results.length} expired file(s).`);

  for (const record of expiredRecords.results) {
    try {
      // Delete from R2
      await env.FILES_BUCKET.delete(record.key);
      // Delete from D1
      await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(record.key).run();
      console.log(`Cleanup: deleted ${record.key}`);
    } catch (err) {
      console.error(`Cleanup: failed to delete ${record.key}:`, err);
    }
  }
}