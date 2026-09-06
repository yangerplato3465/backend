import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  listUsersQuerySchema,
  listUsersResponseSchema,
  userParamsSchema,
  userResponseSchema,
} from './user.schemas.js';
import * as userService from './user.service.js';

/**
 * Read-only for now. Creating a user is registration, which needs password
 * hashing and belongs with authentication in Phase 3.
 */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    '/users',
    {
      schema: {
        tags: ['users'],
        summary: 'List users',
        querystring: listUsersQuerySchema,
        response: { 200: listUsersResponseSchema },
      },
    },
    async (request) => userService.listUsers(request.query),
  );

  api.get(
    '/users/:id',
    {
      schema: {
        tags: ['users'],
        summary: 'Get a public user profile',
        params: userParamsSchema,
        response: { 200: userResponseSchema },
      },
    },
    async (request) => userService.getUserById(request.params.id),
  );
}
