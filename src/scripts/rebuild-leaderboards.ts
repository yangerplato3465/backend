/**
 * Rebuild every Redis leaderboard from MongoDB.
 *
 *   pnpm rebuild:leaderboards
 *
 * WHY THIS EXISTS. It is the proof that MongoDB is the source of truth and Redis
 * is a derived index. As long as this script can reconstruct the boards, losing
 * Redis entirely is an inconvenience rather than data loss — which is what makes
 * it acceptable to run Redis without durable persistence, and what makes the
 * answer to "what happens when Redis dies?" a script instead of a shrug.
 *
 * It is also how a scoring rule change gets applied to history: adjust the rule,
 * re-run, and the boards reflect it.
 */
import mongoose from 'mongoose';
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { GameModel } from '../modules/games/game.model.js';
import { PlayModel } from '../modules/plays/play.model.js';
import {
  WINDOW_TTL_SECONDS,
  dayBucket,
  leaderboardKey,
  weekBucket,
} from '../modules/leaderboards/leaderboard.keys.js';

async function main(): Promise<void> {
  await mongoose.connect(env.MONGO_URI);
  const redis = new Redis(env.REDIS_URL);

  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // Monday 00:00 UTC of the current ISO week.
  const dayNum = now.getUTCDay() || 7;
  const startOfWeek = new Date(startOfDay);
  startOfWeek.setUTCDate(startOfWeek.getUTCDate() - (dayNum - 1));

  const games = await GameModel.find();
  console.log(`rebuilding leaderboards for ${games.length} games (UTC ${now.toISOString()})`);

  for (const game of games) {
    const gameId = game._id.toString();
    // Higher-is-better keeps the maximum; lower-is-better keeps the minimum.
    // Written out rather than a computed key, because a dynamic accumulator name
    // does not satisfy Mongoose's aggregation types.
    const groupStage =
      game.scoreDirection === 'higher'
        ? { $group: { _id: '$userId', score: { $max: '$score' } } }
        : { $group: { _id: '$userId', score: { $min: '$score' } } };

    for (const [window, since] of [
      ['global', null],
      ['daily', startOfDay],
      ['weekly', startOfWeek],
    ] as const) {
      const match: Record<string, unknown> = { gameId: game._id, accepted: true };
      if (since) match.submittedAt = { $gte: since };

      // One document per user holding their best score in this window — the same
      // thing ZADD GT/LT maintains incrementally, computed in bulk.
      const best = await PlayModel.aggregate<{ _id: mongoose.Types.ObjectId; score: number }>([
        { $match: match },
        groupStage,
      ]);

      const key = leaderboardKey(window, gameId, now);

      // Delete then repopulate in ONE transaction, so a concurrent reader never
      // observes a half-built board. A DEL followed by a separate ZADD would
      // leave a window in which the leaderboard appears empty.
      const tx = redis.multi().del(key);
      for (const row of best) tx.zadd(key, row.score, row._id.toString());
      if (window !== 'global') tx.expire(key, WINDOW_TTL_SECONDS[window]);
      await tx.exec();

      console.log(`  ${game.slug.padEnd(14)} ${window.padEnd(7)} ${best.length} entries  -> ${key}`);
    }
  }

  console.log(`done. day bucket=${dayBucket(now)} week bucket=${weekBucket(now)}`);
  await redis.quit();
  await mongoose.disconnect();
}

main().catch((err: unknown) => {
  console.error('rebuild failed:', err);
  process.exit(1);
});
