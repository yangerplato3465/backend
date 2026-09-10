import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  leaderboardParamsSchema,
  leaderboardQuerySchema,
  leaderboardResponseSchema,
  playerRankResponseSchema,
} from './leaderboard.schemas.js';
import * as leaderboardService from './leaderboard.service.js';

export async function leaderboardRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/games/:slug/leaderboard',
    {
      schema: {
        tags: ['leaderboards'],
        summary: 'Ranked scores for a game',
        description:
          'Served from a Redis sorted set. `window` selects the all-time board or ' +
          'a self-expiring daily/weekly board.',
        params: leaderboardParamsSchema,
        querystring: leaderboardQuerySchema,
        response: { 200: leaderboardResponseSchema },
      },
    },
    async (request) =>
      leaderboardService.getLeaderboard(
        app.redis,
        request.params.slug,
        request.query.window,
        request.query.limit,
        request.query.offset,
      ),
  );

  api.get(
    '/games/:slug/leaderboard/me',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['leaderboards'],
        summary: 'The caller’s own rank — O(log N) via ZREVRANK',
        security: [{ bearerAuth: [] }],
        params: leaderboardParamsSchema,
        querystring: leaderboardQuerySchema.pick({ window: true }),
        response: { 200: playerRankResponseSchema },
      },
    },
    async (request) =>
      leaderboardService.getPlayerRank(
        app.redis,
        request.params.slug,
        request.query.window,
        request.user.sub,
      ),
  );
}
