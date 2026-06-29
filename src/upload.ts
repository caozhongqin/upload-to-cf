import type { Env } from './types';

// Generate a 4-character alphanumeric key
function generateKey(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 4; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

// Check if key already exists in D1
async function generateUniqueKey(db: D1Database): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const key = generateKey();
    const existing = await db.prepare('SELECT key FROM files WHERE key = ?').bind(key).first();
    if (!existing) {
      return key;
    }
  }
  // Fallback: use timestamp-based key if collisions happen
  return Date.now().toString(36).slice(-4);
}

export async function handleUpload(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const fileField = formData.get('file');

  if (!fileField || typeof fileField !== 'object' || !('arrayBuffer' in fileField)) {
    return new Response(JSON.stringify({ error: 'No file provided. Use -F "file=@path" to upload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = fileField as unknown as File;
  const fileBuffer = await file.arrayBuffer();

  // Check file size (max 100MB)
  if (fileBuffer.byteLength > 100 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'File too large. Maximum size is 100MB.' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Generate unique key
  const key = await generateUniqueKey(env.DB);

  // Calculate expiration (24 hours from now)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Upload to R2
  await env.FILES_BUCKET.put(key, fileBuffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  // Save metadata to D1
  await env.DB.prepare(
    'INSERT INTO files (key, filename, size, content_type, expires_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(key, file.name, fileBuffer.byteLength, file.type || 'application/octet-stream', expiresAt)
    .run();

  return new Response(
    JSON.stringify({
      key,
      filename: file.name,
      size: fileBuffer.byteLength,
      expires_at: expiresAt,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}