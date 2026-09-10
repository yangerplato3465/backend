import { z } from 'zod';

export const leaderboardParamsSchema = z.object({ slug: z.string().min(2).max(64) });

export const leaderboardQuerySchema = z.object({
  window: z.enum(['global', 'daily', 'weekly']).default('global'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Offset is acceptable HERE, unlike the cursor pagination used for lists
  // (ADR 0009). ZREVRANGE takes an index range and is O(log N + page) — there is
  // no skip-and-discard cost — and a leaderboard's whole purpose is stable
  // numbered ranks, which is exactly what a cursor cannot express.
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const leaderboardEntrySchema = z.object({
  rank: z.number(),
  userId: z.string(),
  displayName: z.string(),
  score: z.number(),
});

export const leaderboardResponseSchema = z.object({
  game: z.string(),
  window: z.enum(['global', 'daily', 'weekly']),
  total: z.number(),
  entries: z.array(leaderboardEntrySchema),
});

export const playerRankResponseSchema = z.object({
  game: z.string(),
  window: z.enum(['global', 'daily', 'weekly']),
  rank: z.number().nullable(),
  score: z.number().nullable(),
  total: z.number(),
});
