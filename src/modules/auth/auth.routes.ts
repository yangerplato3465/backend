import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  authResponseSchema,
  loginSchema,
  meResponseSchema,
  refreshSchema,
  registerSchema,
} from './auth.schemas.js';
import * as authService from './auth.service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  // Built once and shared: the service needs Redis and a signer, not the app.
  const deps: authService.AuthDeps = {
    redis: app.redis,
    signAccessToken: app.signAccessToken,
  };

  api.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account and start a session',
        body: registerSchema,
        response: { 201: authResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await authService.register(deps, request.body);
      return reply.code(201).send(result);
    },
  );

  api.post(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for an access + refresh token pair',
        body: loginSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => authService.login(deps, request.body),
  );

  api.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Rotate a refresh token for a new pair',
        description:
          'Single-use. Presenting an already-rotated token is treated as theft ' +
          'and revokes every session in that family.',
        body: refreshSchema,
        response: { 200: authResponseSchema },
      },
    },
    async (request) => authService.refresh(deps, request.body.refreshToken),
  );

  api.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token family',
        body: refreshSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await authService.logout(deps, request.body.refreshToken);
      // 204 whether or not the token existed: logout is idempotent, and telling
      // a caller their token was already invalid leaks information.
      return reply.code(204).send(null);
    },
  );

  api.get(
    '/auth/me',
    {
      // The guard runs before the handler; the handler can trust request.user.
      preHandler: app.authenticate,
      schema: {
        tags: ['auth'],
        summary: 'The authenticated user, including their own email',
        security: [{ bearerAuth: [] }],
        response: { 200: meResponseSchema },
      },
    },
    async (request) => authService.getMe(request.user.sub),
  );
}
