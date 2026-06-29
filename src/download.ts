import type { Env } from './types';
import { getLimitConfig, checkAndIncrementDailyLimit } from './limits';

export async function handleDownload(request: Request, env: Env, ctx: ExecutionContext, key: string): Promise<Response> {
  // Look up file metadata in D1
  const record = await env.DB.prepare(
    'SELECT key, filename, content_type FROM files WHERE key = ? AND downloaded = 0'
  )
    .bind(key)
    .first<{ key: string; filename: string; content_type: string }>();

  if (!record) {
    return new Response(JSON.stringify({ error: 'File not found or already downloaded.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check daily download limit (after confirming file exists)
  const limitConfig = await getLimitConfig(env);
  if (limitConfig.dailyDownloadLimit !== null) {
    const result = await checkAndIncrementDailyLimit(env, 'download', limitConfig.dailyDownloadLimit);
    if (!result.allowed) {
      return new Response(
        JSON.stringify({
          error: `Daily download limit reached (${result.current}/${result.limit}). Please try again later.（每日下载次数已达上限 ${result.limit} 次）`,
        }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }
  }

  // Get file from R2
  const fileObject = await env.FILES_BUCKET.get(key);
  if (!fileObject) {
    // R2 file missing, clean up D1 record
    await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
    return new Response(JSON.stringify({ error: 'File not found on storage.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Stream the file to the client
  const headers = new Headers();
  headers.set('Content-Type', record.content_type);
  headers.set('Content-Disposition', `attachment; filename="${record.filename}"`);
  headers.set('Cache-Control', 'no-store');

  const response = new Response(fileObject.body, { headers });

  // After successful download, delete file from R2 and D1
  // We use waitUntil to not block the response
  const cleanup = async () => {
    try {
      await env.FILES_BUCKET.delete(key);
      await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  };

  // Use waitUntil to not block the response
  ctx.waitUntil(cleanup());

  return response;
}