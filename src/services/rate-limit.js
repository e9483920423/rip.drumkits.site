export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const buckets = new Map();

  return function allow(key) {
    const time = now();
    const recent = (buckets.get(key) || []).filter((stamp) => time - stamp < windowMs);
    if (recent.length >= limit) {
      buckets.set(key, recent);
      return false;
    }
    recent.push(time);
    buckets.set(key, recent);
    if (buckets.size > 5000) buckets.clear();
    return true;
  };
}
