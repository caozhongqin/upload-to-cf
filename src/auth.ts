import type { Env } from './types';

// Auth middleware - validate API Key from KV
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

  const result = await env.API_KEYS.get(token);
  return result !== null;
}