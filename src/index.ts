import { validateApiKey } from './auth';
import { handleUpload } from './upload';
import { handleDownload } from './download';
import { handleCleanup } from './cleanup';
import type { Env } from './types';

// Main Worker handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check (no auth required)
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // All other endpoints require API key authentication
    const isValid = await validateApiKey(request, env);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized. Provide a valid API key via Authorization header.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Upload endpoint
    if (path === '/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    // Download endpoint: /download/<key>
    if (path.startsWith('/download/') && request.method === 'GET') {
      const key = path.slice(10); // Remove '/download/'
      if (!key || key.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing file key.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handleDownload(request, env, ctx, key);
    }

    // 404 for unknown routes
    return new Response(JSON.stringify({ error: 'Not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // Scheduled cleanup handler
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleCleanup(env));
  },
};