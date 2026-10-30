// Local-only JWT keys, mirroring Supabase's anon / service_role keys.
import crypto from 'node:crypto';

export const JWT_SECRET = process.env.LOCAL_JWT_SECRET || 'local-dev-jwt-secret-not-for-production-0123456789';

const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

export function signJwt(claims, secret = JWT_SECRET) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400, ...claims });
  const sig = crypto.createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

export const ANON_KEY = signJwt({ role: 'anon', iss: 'supabase-local' });
export const SERVICE_KEY = signJwt({ role: 'service_role', iss: 'supabase-local' });
export const userToken = (uid, email) => signJwt({ role: 'authenticated', sub: uid, email, aud: 'authenticated' });
