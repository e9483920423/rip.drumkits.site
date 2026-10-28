import { createHash, timingSafeEqual } from 'node:crypto';

export function readAccessToken(request) {
  const header = request.headers['x-access-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, '').trim();
  }
  const query = request.query?.token;
  if (typeof query === 'string' && query.trim()) return query.trim();
  return '';
}

export function accessTokenMatches(provided, expected) {
  if (!expected) return true;
  if (typeof provided !== 'string' || !provided) return false;
  const left = createHash('sha256').update(provided, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(left, right);
}
