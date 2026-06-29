/**
 * Upload to CF —— 单文件 Worker（网页部署专用）
 *
 * 这是把 src/ 下所有 TypeScript 源码合并、去掉类型后的版本。
 * 部署时只需把本文件全部内容复制粘贴到 Cloudflare 网页编辑器里即可，
 * 不需要在电脑上安装任何东西、不需要打开终端。
 *
 * 它会用到 3 个绑定（在 Worker「设置 → 绑定」里配置，名字必须和下面一致）：
 *   - R2 存储桶   FILES_BUCKET   （存文件本体）
 *   - D1 数据库   DB             （存文件记录）
 *   - KV 命名空间 API_KEYS        （存你的下载/上传密码）
 * 另外还需要一个定时任务 Cron：0 * * * *（每小时自动清理过期文件）。
 */

// ============================================================
// 认证：校验 API Key（密码）
// KV 里只需存一条：键名 "API_KEY"，值就是你的密码
// ============================================================
async function validateApiKey(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  // 支持 "Bearer sk-xxx" 和直接 "sk-xxx" 两种写法
  let token = authHeader;
  if (token.startsWith('Bearer ')) {
    token = token.slice(7);
  }

  const correctKey = await env.API_KEYS.get('API_KEYS');
  return correctKey !== null && token === correctKey;
}

// ============================================================
// 上传：生成 4 位短 key + 存到 R2 + 写一条记录到 D1
// ============================================================
function generateKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let key = '';
  for (let i = 0; i < 4; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

async function generateUniqueKey(db) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const key = generateKey();
    const existing = await db.prepare('SELECT key FROM files WHERE key = ?').bind(key).first();
    if (!existing) {
      return key;
    }
  }
  // 万一重复太多次，用时间戳兜底
  return Date.now().toString(36).slice(-4);
}

async function handleUpload(request, env) {
  const formData = await request.formData();
  const fileField = formData.get('file');

  if (!fileField || typeof fileField !== 'object' || !('arrayBuffer' in fileField)) {
    return new Response(JSON.stringify({ error: 'No file provided. Use -F "file=@path" to upload.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const file = fileField;
  const fileBuffer = await file.arrayBuffer();

  // 单文件最大 100MB
  if (fileBuffer.byteLength > 100 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: 'File too large. Maximum size is 100MB.' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 生成唯一短 key
  const key = await generateUniqueKey(env.DB);

  // 24 小时后过期
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // 存到 R2
  await env.FILES_BUCKET.put(key, fileBuffer, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  // 记录写到 D1
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

// ============================================================
// 下载：按 key 取出文件，下载完立即自毁
// ============================================================
async function handleDownload(request, env, ctx, key) {
  // 先查记录
  const record = await env.DB.prepare(
    'SELECT key, filename, content_type FROM files WHERE key = ? AND downloaded = 0'
  )
    .bind(key)
    .first();

  if (!record) {
    return new Response(JSON.stringify({ error: 'File not found or already downloaded.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 从 R2 取文件
  const fileObject = await env.FILES_BUCKET.get(key);
  if (!fileObject) {
    // R2 里文件没了，顺手清掉 D1 里的脏记录
    await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
    return new Response(JSON.stringify({ error: 'File not found on storage.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 把文件流式发给客户端
  const headers = new Headers();
  headers.set('Content-Type', record.content_type);
  headers.set('Content-Disposition', `attachment; filename="${record.filename}"`);
  headers.set('Cache-Control', 'no-store');

  const response = new Response(fileObject.body, { headers });

  // 下载成功后，删掉 R2 文件 + D1 记录（用 waitUntil，不挡响应）
  const cleanup = async () => {
    try {
      await env.FILES_BUCKET.delete(key);
      await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(key).run();
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  };

  ctx.waitUntil(cleanup());

  return response;
}

// ============================================================
// 定时清理：删掉过期的文件（由 Cron 每小时触发）
// ============================================================
async function handleCleanup(env) {
  const now = new Date().toISOString();

  const expiredRecords = await env.DB.prepare(
    'SELECT key FROM files WHERE expires_at < ?'
  )
    .bind(now)
    .all();

  if (!expiredRecords.results || expiredRecords.results.length === 0) {
    console.log('Cleanup: no expired files found.');
    return;
  }

  console.log(`Cleanup: found ${expiredRecords.results.length} expired file(s).`);

  for (const record of expiredRecords.results) {
    try {
      await env.FILES_BUCKET.delete(record.key);
      await env.DB.prepare('DELETE FROM files WHERE key = ?').bind(record.key).run();
      console.log(`Cleanup: deleted ${record.key}`);
    } catch (err) {
      console.error(`Cleanup: failed to delete ${record.key}:`, err);
    }
  }
}

// ============================================================
// 入口：路由分发
// ============================================================
export default {
  // 处理普通网页请求（上传/下载/健康检查）
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 健康检查，不需要密码
    if (path === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 其它接口都要校验密码
    const isValid = await validateApiKey(request, env);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized. Provide a valid API key via Authorization header.' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 上传
    if (path === '/upload' && request.method === 'POST') {
      return handleUpload(request, env);
    }

    // 下载：/download/<key>
    if (path.startsWith('/download/') && request.method === 'GET') {
      const key = path.slice(10); // 去掉 '/download/'
      if (!key || key.length === 0) {
        return new Response(JSON.stringify({ error: 'Missing file key.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return handleDownload(request, env, ctx, key);
    }

    // 其它路径一律 404
    return new Response(JSON.stringify({ error: 'Not found.' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  },

  // 定时任务入口（由 Cron 触发）
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCleanup(env));
  },
};
