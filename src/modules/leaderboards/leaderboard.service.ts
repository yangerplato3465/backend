import type { Redis } from 'ioredis';
import { GameModel } from '../games/game.model.js';
import { UserModel } from '../users/user.model.js';
import { NotFoundError } from '../../shared/errors.js';
import { WINDOW_TTL_SECONDS, leaderboardKey, type Window } from './leaderboard.keys.js';

/**
 * Redis sorted sets as leaderboards.
 *
 * This is the reason Redis is in this architecture rather than "we added a cache".
 * `ZREVRANK` answers "what rank is this player?" in O(log N) — the same cost with
 * a hundred players or ten million. The MongoDB equivalent is counting every
 * document with a better score, which grows with the collection.
 *
 * MongoDB stays the source of truth. Everything here is a DERIVED INDEX that can
 * be rebuilt from the `plays` collection at any time — see
 * `src/scripts/rebuild-leaderboards.ts`. That is what makes it safe for Redis to
 * be non-durable.
 */

/**
 * Sorted sets only ever sort ascending, so the game's `scoreDirection` decides
 * which end of the set is "winning" and which ZADD flag keeps a personal best:
 *
 *   higher-is-better (Tetris)   -> best = MAX -> ZADD GT, read with ZREVRANGE/ZREVRANK
 *   lower-is-better (speedrun)  -> best = MIN -> ZADD LT, read with ZRANGE/ZRANK
 *
 * Using GT for a lower-is-better game would keep each player's WORST time and
 * rank the field upside down.
 */
type Direction = 'higher' | 'lower';

function bestFlag(d: Direction): 'GT' | 'LT' {
  return d === 'higher' ? 'GT' : 'LT';
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
}

/**
 * Record a score on all three boards.
 *
 * `GT`/`LT` mean "only update if strictly better", so a worse replay never
 * downgrades a personal best — and it takes one round trip, with no read-then-
 * compare-then-write race between concurrent submissions.
 *
 * `CH` makes ZADD report how many entries actually changed, which tells the
 * caller whether this was a new personal best.
 */
export async function recordScore(
  redis: Redis,
  gameId: string,
  direction: Direction,
  userId: string,
  score: number,
  now = new Date(),
): Promise<{ improved: boolean }> {
  const flag = bestFlag(direction);

  const globalKey = leaderboardKey('global', gameId, now);
  const dailyKey = leaderboardKey('daily', gameId, now);
  const weeklyKey = leaderboardKey('weekly', gameId, now);

  // One pipeline: six commands, one round trip.
  const results = await redis
    .multi()
    .zadd(globalKey, flag, 'CH', score, userId)
    .zadd(dailyKey, flag, 'CH', score, userId)
    .expire(dailyKey, WINDOW_TTL_SECONDS.daily)
    .zadd(weeklyKey, flag, 'CH', score, userId)
    .expire(weeklyKey, WINDOW_TTL_SECONDS.weekly)
    .exec();

  // results[0] is the global ZADD: [error, changedCount]
  const changed = results?.[0]?.[1];
  return { improved: typeof changed === 'number' && changed > 0 };
}

async function resolveGame(slug: string) {
  const game = await GameModel.findOne({ slug });
  if (!game) throw new NotFoundError('Game', slug);
  return game;
}

/**
 * Attach display names to a page of leaderboard rows.
 *
 * Deliberately ONE query with `$in` rather than a lookup per row. A 100-row page
 * would otherwise issue 100 round trips — the classic N+1 that makes a fast Redis
 * read pointless. The Redis call is O(log N + page); the join must not be worse.
 */
async function attachNames(rows: { userId: string; score: number }[], startRank: number) {
  if (rows.length === 0) return [];

  const users = await UserModel.find({ _id: { $in: rows.map((r) => r.userId) } })
    .select('displayName')
    .lean();

  const nameById = new Map(users.map((u) => [u._id.toString(), u.displayName]));

  return rows.map((row, i) => ({
    rank: startRank + i,
    userId: row.userId,
    // A user deleted since their score was recorded still has a board entry.
    displayName: nameById.get(row.userId) ?? '[deleted user]',
    score: row.score,
  }));
}

export async function getLeaderboard(
  redis: Redis,
  slug: string,
  window: Window,
  limit: number,
  offset: number,
) {
  const game = await resolveGame(slug);
  const key = leaderboardKey(window, game._id.toString());
  const direction = game.scoreDirection as Direction;

  const start = offset;
  const stop = offset + limit - 1;

  // ZREVRANGE for higher-is-better, ZRANGE for lower-is-better.
  const flat =
    direction === 'higher'
      ? await redis.zrevrange(key, start, stop, 'WITHSCORES')
      // `stop` is stringified because ioredis types zrange's stop as
      // string | Buffer while zrevrange accepts a number. Same Redis command
      // shape, inconsistent typings.
      : await redis.zrange(key, start, String(stop), 'WITHSCORES');

  // Redis returns a flat [member, score, member, score, ...] array.
  const rows: { userId: string; score: number }[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    rows.push({ userId: flat[i] as string, score: Number(flat[i + 1]) });
  }

  const [entries, total] = await Promise.all([
    attachNames(rows, offset + 1), // ranks are 1-based for humans
    redis.zcard(key),
  ]);

  return { game: game.slug, window, total, entries };
}

/**
 * One player's rank — the operation that justifies Redis.
 *
 * `ZREVRANK` is O(log N). Answering this from MongoDB means
 * `countDocuments({score: {$gt: mine}})`, which scales with the collection.
 */
export async function getPlayerRank(redis: Redis, slug: string, window: Window, userId: string) {
  const game = await resolveGame(slug);
  const key = leaderboardKey(window, game._id.toString());
  const direction = game.scoreDirection as Direction;

  const [rank, score, total] = await Promise.all([
    direction === 'higher' ? redis.zrevrank(key, userId) : redis.zrank(key, userId),
    redis.zscore(key, userId),
    redis.zcard(key),
  ]);

  // null rank = this player has no accepted score on this board yet.
  if (rank === null || score === null) {
    return { game: game.slug, window, rank: null, score: null, total };
  }

  return { game: game.slug, window, rank: rank + 1, score: Number(score), total };
}
