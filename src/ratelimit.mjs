const buckets = new Map();

export const RATE_LIMIT_CONFIGS = Object.freeze({
  user: Object.freeze({
    capacity: 30,     // Max burst: 30 tokens
    fillRate: 5       // Refill rate: 5 tokens / second
  }),
  apiKey: Object.freeze({
    capacity: 60,     // Max burst: 60 tokens
    fillRate: 10      // Refill rate: 10 tokens / second
  }),
  anon: Object.freeze({
    capacity: 20,
    fillRate: 2
  }),
  service: Object.freeze({
    capacity: 100,    // Max burst: 100 tokens
    fillRate: 20      // Refill rate: 20 tokens / second
  })
});

function getBucket(bucketKey, config) {
  let bucket = buckets.get(bucketKey);
  const now = Date.now();

  if (!bucket) {
    bucket = {
      tokens: config.capacity,
      capacity: config.capacity,
      fillRate: config.fillRate,
      lastRefill: now
    };
    buckets.set(bucketKey, bucket);
  }
  return bucket;
}

export function consumeToken(bucketKey, config = RATE_LIMIT_CONFIGS.user, cost = 1) {
  const bucket = getBucket(bucketKey, config);
  const now = Date.now();
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + (elapsedSec * bucket.fillRate));
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfter: 0,
      limit: bucket.capacity
    };
  }

  const missingTokens = cost - bucket.tokens;
  const retryAfter = Math.max(1, Math.ceil(missingTokens / bucket.fillRate));

  return {
    allowed: false,
    remaining: 0,
    retryAfter,
    limit: bucket.capacity
  };
}

export function inspectBucket(bucketKey, config = RATE_LIMIT_CONFIGS.user) {
  const bucket = getBucket(bucketKey, config);
  const now = Date.now();
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  const currentTokens = Math.min(bucket.capacity, bucket.tokens + (elapsedSec * bucket.fillRate));

  return {
    tokens: Math.round(currentTokens * 10) / 10,
    capacity: bucket.capacity,
    fillRate: bucket.fillRate,
    percentage: Math.round((currentTokens / bucket.capacity) * 100)
  };
}

export function getRateLimitHeaders(result) {
  const headers = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining)
  };
  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfter);
    headers['X-RateLimit-Reset'] = String(result.retryAfter);
  }
  return headers;
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.lastRefill < cutoff && bucket.tokens >= bucket.capacity) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000);

if (cleanupTimer.unref) cleanupTimer.unref();
