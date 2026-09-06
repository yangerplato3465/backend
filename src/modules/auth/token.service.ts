import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { env } from '../../config/env.js';
import { UnauthorizedError } from '../../shared/errors.js';

/**
 * Refresh tokens, stored in Redis.
 *
 * WHY REDIS AND NOT A JWT: an access token is stateless and therefore cannot be
 * revoked — that is the trade-off that makes it fast. A refresh token must be
 * revocable (logout, password change, theft), so it needs server-side state.
 * Redis is the right store: every entry is short-lived and needs a TTL, which is
 * a native Redis feature rather than a cleanup job.
 *
 * The tokens are opaque random strings, not JWTs. There is nothing to encode —
 * the server looks them up anyway — and an opaque token cannot leak claims if
 * it ends up in a log.
 *
 * KEYS
 *   refresh:token:{tokenId}   -> {userId, familyId}   the live token
 *   refresh:used:{tokenId}    -> familyId             a token already rotated
 *   refresh:family:{familyId} -> SET of tokenIds      every token in one login
 */

interface TokenRecord {
  userId: string;
  familyId: string;
}

const tokenKey = (id: string) => `refresh:token:${id}`;
const usedKey = (id: string) => `refresh:used:${id}`;
const familyKey = (id: string) => `refresh:family:${id}`;

/** 256 bits of entropy — not guessable, and never derived from user data. */
function newId(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

async function storeToken(redis: Redis, userId: string, familyId: string): Promise<string> {
  const tokenId = newId();
  const ttl = env.REFRESH_TOKEN_TTL_SECONDS;

  const record: TokenRecord = { userId, familyId };

  // Pipelined so all three writes make one round trip.
  await redis
    .multi()
    .set(tokenKey(tokenId), JSON.stringify(record), 'EX', ttl)
    .sadd(familyKey(familyId), tokenId)
    .expire(familyKey(familyId), ttl)
    .exec();

  return tokenId;
}

/** Called at login: starts a brand-new token family (one family per device/session). */
export async function issueRefreshToken(redis: Redis, userId: string): Promise<string> {
  return storeToken(redis, userId, newId(16));
}

/**
 * Rotate: every refresh burns the old token and returns a new one.
 *
 * REUSE DETECTION. Because a token is single-use, seeing the same one twice means
 * it was captured — the legitimate client and an attacker now both hold it, and
 * we cannot tell which is which. The safe response is to revoke the ENTIRE family,
 * forcing a real re-login. Rotation without this check is much weaker: a stolen
 * token would simply keep working alongside the victim's.
 */
export async function rotateRefreshToken(
  redis: Redis,
  tokenId: string,
): Promise<{ userId: string; tokenId: string }> {
  // GETDEL is atomic: under two concurrent refreshes with the same token, exactly
  // one caller receives the value. A GET followed by a DEL would let both through.
  const raw = await redis.getdel(tokenKey(tokenId));

  if (!raw) {
    // Not live. Was it live before? If so this is a replay.
    const familyId = await redis.get(usedKey(tokenId));
    if (familyId) {
      await revokeFamily(redis, familyId);
      throw new UnauthorizedError(
        'Refresh token reuse detected; all sessions for this login have been revoked',
        'TOKEN_REUSE_DETECTED',
      );
    }
    throw new UnauthorizedError('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }

  const record = JSON.parse(raw) as TokenRecord;

  // Remember it as spent, so a later replay is detected rather than merely rejected.
  await redis
    .multi()
    .set(usedKey(tokenId), record.familyId, 'EX', env.REFRESH_TOKEN_TTL_SECONDS)
    .srem(familyKey(record.familyId), tokenId)
    .exec();

  const nextTokenId = await storeToken(redis, record.userId, record.familyId);
  return { userId: record.userId, tokenId: nextTokenId };
}

/** Revoke every token in a family — used on logout and on reuse detection. */
export async function revokeFamily(redis: Redis, familyId: string): Promise<void> {
  const tokenIds = await redis.smembers(familyKey(familyId));
  const pipeline = redis.multi();
  for (const id of tokenIds) pipeline.del(tokenKey(id));
  pipeline.del(familyKey(familyId));
  await pipeline.exec();
}

/** Logout: revoke the whole family so every rotation descendant dies too. */
export async function revokeByToken(redis: Redis, tokenId: string): Promise<void> {
  const raw = await redis.get(tokenKey(tokenId));
  if (!raw) return; // Already gone — logout is idempotent.
  const record = JSON.parse(raw) as TokenRecord;
  await revokeFamily(redis, record.familyId);
}
