import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createGameSchema,
  gameParamsSchema,
  gameResponseSchema,
  listGamesQuerySchema,
  listGamesResponseSchema,
  updateGameSchema,
} from './game.schemas.js';
import * as gameService from './game.service.js';

/**
 * HTTP layer. Its only jobs are: declare the contract, call the service, and
 * pick a status code. No business logic and no database access belong here.
 *
 * Because the schemas are attached to each route, Fastify validates the request
 * BEFORE the handler runs — so `request.body` is already typed and trusted, and
 * these handlers contain no defensive checks at all.
 */
export async function gameRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/games',
    {
      schema: {
        tags: ['games'],
        summary: 'List games (newest first, cursor-paginated)',
        querystring: listGamesQuerySchema,
        response: { 200: listGamesResponseSchema },
      },
    },
    async (request) => gameService.listGames(request.query),
  );

  api.get(
    '/games/:slug',
    {
      schema: {
        tags: ['games'],
        summary: 'Get one game by slug',
        params: gameParamsSchema,
        response: { 200: gameResponseSchema },
      },
    },
    async (request) => gameService.getGameBySlug(request.params.slug),
  );

  api.post(
    '/games',
    {
      schema: {
        tags: ['games'],
        summary: 'Create a game',
        body: createGameSchema,
        response: { 201: gameResponseSchema },
      },
    },
    async (request, reply) => {
      const game = await gameService.createGame(request.body);
      // 201 + Location is the correct answer to "I made you a new resource".
      return reply.code(201).header('Location', `/games/${game.slug}`).send(game);
    },
  );

  api.patch(
    '/games/:slug',
    {
      schema: {
        tags: ['games'],
        summary: 'Update a game',
        params: gameParamsSchema,
        body: updateGameSchema,
        response: { 200: gameResponseSchema },
      },
    },
    // PATCH, not PUT: the body is a partial update, not a full replacement.
    async (request) => gameService.updateGame(request.params.slug, request.body),
  );

  api.delete(
    '/games/:slug',
    {
      schema: {
        tags: ['games'],
        summary: 'Delete a game',
        params: gameParamsSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await gameService.deleteGame(request.params.slug);
      // 204 = success, deliberately no body. `null` satisfies the declared
      // response type; Fastify omits the body entirely for a 204.
      return reply.code(204).send(null);
    },
  );
}
