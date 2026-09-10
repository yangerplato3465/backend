import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { GameModel } from '../games/game.model.js';
import { PlayModel } from './play.model.js';
import type { StartPlayInput, SubmitPlayInput } from './play.schemas.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';
import { recordScore } from '../leaderboards/leaderboard.service.js';

/**
 * Anti-cheat score submission.
 *
 * The naive design is a single `POST /scores {gameId, score}`, which cannot work:
 * there is nothing to check the score against, so anyone can curl 999999999.
 *
 * Splitting it in two gives the server facts the client cannot forge — WHEN the
 * play started, and that this particular attempt has not already been counted.
 *
 * Be honest about the limit: this makes cheating expensive, not impossible. A
 * determined attacker can still call /plays/start, wait a realistic interval, and
 * submit a plausible fake. Truly unforgeable scoring requires server-authoritative
 * gameplay, which is what Phase 8 does. This is the right level for score-attack
 * games, and knowing where the line sits matters more than pretending there isn't one.
 */

/** How long a play token stays valid. Longer than any realistic session. */
const PLAY_TOKEN_TTL_SECONDS = 60 * 60 * 4;

/**
 * Nobody finishes a real game in under a second. This blocks the simplest attack:
 * start and submit back to back, where a tiny elapsed time would otherwise make
 * almost any score look like a plausible rate.
 */
const MIN_PLAY_DURATION_MS = 1_000;

const nonceKey = (nonce: string) => `play:nonce:${nonce}`;

interface NonceRecord {
  userId: string;
  gameId: string;
  gameSlug: string;
  startedAt: number;
}

export async function startPlay(redis: Redis, userId: string, input: StartPlayInput) {
  const game = await GameModel.findOne({ slug: input.gameSlug, isActive: true });
  if (!game) throw new NotFoundError('Game', input.gameSlug);

  const nonce = randomBytes(32).toString('hex');
  const startedAt = Date.now();

  const record: NonceRecord = {
    userId,
    gameId: game._id.toString(),
    gameSlug: game.slug,
    startedAt,
  };

  // NX = "only if it does not already exist". A 256-bit random value will not
  // collide, so this is belt-and-braces — but it also means the write can never
  // clobber a live token, which matters once several pods serve this route.
  const stored = await redis.set(
    nonceKey(nonce),
    JSON.stringify(record),
    'EX',
    PLAY_TOKEN_TTL_SECONDS,
    'NX',
  );
  if (stored !== 'OK') throw new BadRequestError('Could not start play, please retry');

  return {
    playToken: nonce,
    gameSlug: game.slug,
    startedAt: new Date(startedAt).toISOString(),
    expiresAt: new Date(startedAt + PLAY_TOKEN_TTL_SECONDS * 1_000).toISOString(),
  };
}

export async function submitPlay(redis: Redis, userId: string, input: SubmitPlayInput) {
  /**
   * READ FIRST, THEN CLAIM. The order matters and was originally wrong.
   *
   * The first version called GETDEL immediately and checked ownership afterwards.
   * That consumed the token before deciding whether the caller was entitled to
   * it, so ANY failed attempt destroyed it — verified: an attacker submitting a
   * stranger's token got a 400, and the legitimate player then lost their score
   * to "already used". A griefing vector: seeing a token was enough to burn it.
   *
   * So ownership is verified against a non-destructive GET, and only a caller who
   * passes that check goes on to claim the token.
   */
  const peek = await redis.get(nonceKey(input.playToken));
  if (!peek) {
    // Covers all of: never issued, already submitted, and expired. They are
    // deliberately not distinguished — telling a probing client which one it was
    // helps them work out what to forge.
    throw new BadRequestError('Invalid, expired, or already-used play token');
  }

  const peeked = JSON.parse(peek) as NonceRecord;

  // Checked BEFORE the token is consumed, so a rejected caller cannot burn it.
  if (peeked.userId !== userId) {
    throw new BadRequestError('Play token does not belong to this user');
  }

  /**
   * Now claim it. GETDEL reads and deletes in one operation, which is what makes
   * a play single-use: with GET followed by DEL, two concurrent submissions of
   * the same token would both read a live value and both be counted.
   *
   * The GET above does not weaken this. Two concurrent legitimate submissions can
   * both pass the ownership check, but only one GETDEL returns a value — the
   * other sees null and is correctly rejected as already used.
   */
  const raw = await redis.getdel(nonceKey(input.playToken));
  if (!raw) {
    // Lost the race against a concurrent submission of the same token.
    throw new BadRequestError('Invalid, expired, or already-used play token');
  }

  const record = JSON.parse(raw) as NonceRecord;

  const game = await GameModel.findById(record.gameId);
  if (!game) throw new NotFoundError('Game', record.gameSlug);

  const submittedAt = Date.now();
  const durationMs = submittedAt - record.startedAt;
  // Guard the divisor: durationMs can be 0 on a fast local submit, and dividing
  // by zero yields Infinity, which would then compare as "always implausible"
  // in one direction and poison the stored number in the other.
  const durationSeconds = Math.max(durationMs, 1) / 1_000;
  const scorePerSecond = input.score / durationSeconds;

  let rejectionReason: string | null = null;

  if (durationMs < MIN_PLAY_DURATION_MS) {
    rejectionReason = `Play lasted ${durationMs}ms, below the ${MIN_PLAY_DURATION_MS}ms minimum`;
  } else if (scorePerSecond > game.maxPlausibleScorePerSecond) {
    rejectionReason =
      `Score implies ${scorePerSecond.toFixed(1)} points/second, ` +
      `above this game's maximum of ${game.maxPlausibleScorePerSecond}`;
  }

  // Store rejected attempts as well — see the comment on the model.
  const play = await PlayModel.create({
    userId: new Types.ObjectId(userId),
    gameId: game._id,
    nonce: input.playToken,
    startedAt: new Date(record.startedAt),
    submittedAt: new Date(submittedAt),
    durationMs,
    score: input.score,
    accepted: rejectionReason === null,
    ...(rejectionReason ? { rejectionReason } : {}),
    scorePerSecond,
  });

  /**
   * Only ACCEPTED scores reach the leaderboard. MongoDB keeps every attempt for
   * auditing; Redis holds only what counts.
   *
   * The write happens after the play is persisted, so the source of truth is
   * never behind the derived index. If this Redis write failed, the board would
   * be briefly stale — and `rebuild-leaderboards.ts` reconstructs it from the
   * `plays` collection, which is why that is tolerable.
   */
  let newPersonalBest: boolean | null = null;
  if (play.accepted) {
    const result = await recordScore(
      redis,
      game._id.toString(),
      game.scoreDirection as 'higher' | 'lower',
      userId,
      input.score,
    );
    newPersonalBest = result.improved;
  }

  return {
    playId: play._id.toString(),
    accepted: play.accepted,
    score: play.score,
    durationMs: play.durationMs,
    scorePerSecond: Number(scorePerSecond.toFixed(3)),
    rejectionReason,
    newPersonalBest,
  };
}
