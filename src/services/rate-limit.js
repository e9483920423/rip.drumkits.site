export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 5000 } = {}) {
  const buckets = new Map();

  function prune(time) {
    for (const [key, stamps] of buckets) {
      const recent = stamps.filter((stamp) => time - stamp < windowMs);
      if (recent.length) buckets.set(key, recent);
      else buckets.delete(key);
    }
  }

  function evictOverflow(keepKey) {
    while (buckets.size >= maxKeys) {
      const oldest = buckets.keys().next().value;
      if (oldest === undefined || oldest === keepKey) break;
      buckets.delete(oldest);
    }
  }

  function allow(key) {
    const time = now();
    let recent = (buckets.get(key) || []).filter((stamp) => time - stamp < windowMs);
    if (recent.length >= limit) {
      buckets.set(key, recent);
      return false;
    }
    if (!buckets.has(key) && buckets.size >= maxKeys) {
      prune(time);
      recent = (buckets.get(key) || []).filter((stamp) => time - stamp < windowMs);
      if (recent.length >= limit) {
        buckets.set(key, recent);
        return false;
      }
      evictOverflow(key);
    }
    recent.push(time);
    buckets.set(key, recent);
    return true;
  }

  allow.size = () => buckets.size;
  return allow;
}

export function limitForPath(pathname) {
  if (pathname === '/api/media/info') return 'inspect';
  if (pathname.startsWith('/api/media/download')) return 'download';
  return 'general';
}
