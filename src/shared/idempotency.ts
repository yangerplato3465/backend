import type { Redis } from 'ioredis';
import { AppError } from './errors.js';

/**
 * Idempotency keys.
 *
 * The problem: a client POSTs a score, the response is lost to a flaky network,
 * and the client retries. Without protection the score is recorded twice. The
 * client cannot tell a lost response from a failed request, so it MUST retry —
 * which means the server is the only place this can be solved.
 *
 * The client sends a unique `Idempotency-Key` header per logical operation. The
 * first request does the work and the result is cached under that key; retries
 * get the cached response back without re-running anything.
 *
 * Keys are namespaced per user so one client cannot read another's cached
 * response by guessing a key.
 */

const IDEMPOTENCY_TTL_SECONDS = 60 * 60 * 24;
const IN_PROGRESS = '__in_progress__';

const idemKey = (userId: string, key: string) => `idem:${userId}:${key}`;

/** 409 for a retry that arrives while the original is still running. */
class InProgressError extends AppError {
  constructor() {
    super(
      'A request with this Idempotency-Key is still in progress; retry shortly',
      409,
      'IDEMPOTENCY_IN_PROGRESS',
    );
  }
}

/**
 * Runs `operation` at most once per (user, key).
 *
 * The marker is claimed with SET NX *before* the work starts, not after. Writing
 * the cache only at the end would leave a window where two concurrent retries
 * both find nothing cached and both execute — which is exactly the duplicate this
 * is meant to prevent.
 */
export async function withIdempotency<T>(
  redis: Redis,
  userId: string,
  key: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  // The header is optional. Without it the caller simply gets no protection —
  // their choice, and it keeps the endpoint usable from a browser address bar.
  if (!key) return operation();

  const redisKey = idemKey(userId, key);

  const claimed = await redis.set(redisKey, IN_PROGRESS, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');

  if (claimed !== 'OK') {
    const cached = await redis.get(redisKey);
    if (cached === null) {
      // The marker expired between SET NX and GET. Vanishingly rare; treat it as
      // a fresh attempt rather than failing the request.
      return operation();
    }
    if (cached === IN_PROGRESS) throw new InProgressError();
    return JSON.parse(cached) as T;
  }

  try {
    const result = await operation();
    // Replace the marker with the real response, keeping the same expiry.
    await redis.set(redisKey, JSON.stringify(result), 'EX', IDEMPOTENCY_TTL_SECONDS);
    return result;
  } catch (error) {
    // Release the key so a retry can genuinely retry. Caching failures would
    // make a transient error permanent for 24 hours.
    await redis.del(redisKey);
    throw error;
  }
}
