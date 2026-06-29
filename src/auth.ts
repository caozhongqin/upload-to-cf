import type { Env } from './types';

// Auth middleware - validate API Key from KV
// KV 里只需要存一条记录：键名 "API_KEY"，值就是你的密码
// 这样最直观，不用把密码当键名用
export async function validateApiKey(request: Request, env: Env): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return false;
  }

  // Support both "Bearer sk-xxx" and just "sk-xxx" format
  let token = authHeader;
  if (token.startsWith('Bearer ')) {
    token = token.slice(7);
  }

  const correctKey = await env.API_KEYS.get('API_KEYS');
  return correctKey !== null && token === correctKey;
}