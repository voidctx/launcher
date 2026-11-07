/**
 * Token Bucket Rate Limiter
 * Supports per-user, per-API-key, and per-service rate limiting.
 * Returns HTTP 429 Too Many Requests and sets Retry-After header when exhausted.
 */

// In-memory bucket storage
const buckets = new Map();

// Default configurations
export const RATE_LIMIT_CONFIGS = {
  // Keyed by session user id for dashboard calls
  user: {
    capacity: 30,     // Max burst: 30 tokens
    fillRate: 5       // Refill rate: 5 tokens / second
  },
  // Keyed by API key for programmatic service calls
  apiKey: {
    capacity: 60,     // Max burst: 60 tokens
    fillRate: 10      // Refill rate: 10 tokens / second
  },
  // Keyed by service name to protect individual services
  service: {
    capacity: 100,    // Max burst: 100 tokens
    fillRate: 20      // Refill rate: 20 tokens / second
  }
};

/**
 * Get or initialize bucket for a given key.
 */
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

/**
 * Consume tokens using the Token Bucket algorithm.
 * @param {string} bucketKey - Unique key for the bucket (e.g. `user:123`, `key:lnch_...`, `svc:weather`)
 * @param {Object} config - { capacity, fillRate }
 * @param {number} cost - Number of tokens to consume (default 1)
 * @returns {Object} { allowed: boolean, remaining: number, retryAfter: number, limit: number }
 */
export function consumeToken(bucketKey, config = RATE_LIMIT_CONFIGS.user, cost = 1) {
  const bucket = getBucket(bucketKey, config);
  const now = Date.now();

  // Calculate tokens added during elapsed time
  const elapsedSec = (now - bucket.lastRefill) / 1000;
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(bucket.capacity, bucket.tokens + (elapsedSec * bucket.fillRate));
    bucket.lastRefill = now;
  }

  // Check if enough tokens are available
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return {
      allowed: true,
      remaining: Math.floor(bucket.tokens),
      retryAfter: 0,
      limit: bucket.capacity
    };
  }

  // Insufficient tokens - calculate required wait time in seconds
  const missingTokens = cost - bucket.tokens;
  const retryAfter = Math.max(1, Math.ceil(missingTokens / bucket.fillRate));

  return {
    allowed: false,
    remaining: 0,
    retryAfter,
    limit: bucket.capacity
  };
}

/**
 * Inspect the current state of a rate limit bucket without consuming tokens.
 */
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

/**
 * Helper to build standard Rate Limit HTTP headers.
 */
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

/**
 * Periodic cleanup of idle buckets to avoid memory leaks (older than 10 minutes)
 */
setInterval(() => {
  const cutoff = Date.now() - (10 * 60 * 1000);
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.lastRefill < cutoff && bucket.tokens >= bucket.capacity) {
      buckets.delete(key);
    }
  }
}, 5 * 60 * 1000).unref?.();
