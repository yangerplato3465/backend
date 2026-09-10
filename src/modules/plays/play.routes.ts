import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  startPlaySchema,
  startPlayResponseSchema,
  submitPlaySchema,
  submitPlayResponseSchema,
} from './play.schemas.js';
import * as playService from './play.service.js';
import { withIdempotency } from '../../shared/idempotency.js';

export async function playRoutes(app: FastifyInstance): Promise<void> {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.post(
    '/plays/start',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['plays'],
        summary: 'Begin a play session and receive a single-use play token',
        description:
          'Call this BEFORE the player starts. The returned token records when ' +
          'play began — a fact the client cannot forge — and is required to submit a score.',
        security: [{ bearerAuth: [] }],
        body: startPlaySchema,
        response: { 201: startPlayResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await playService.startPlay(app.redis, request.user.sub, request.body);
      return reply.code(201).send(result);
    },
  );

  api.post(
    '/plays/submit',
    {
      preHandler: app.authenticate,
      schema: {
        tags: ['plays'],
        summary: 'Submit a score against a play token',
        description:
          'The token is consumed atomically, so a play can be submitted exactly once. ' +
          'Send an Idempotency-Key header so a network retry is safe.',
        security: [{ bearerAuth: [] }],
        body: submitPlaySchema,
        headers: z.object({ 'idempotency-key': z.string().min(8).max(128).optional() }),
        response: { 201: submitPlayResponseSchema },
      },
    },
    async (request, reply) => {
      const result = await withIdempotency(
        app.redis,
        request.user.sub,
        request.headers['idempotency-key'],
        () => playService.submitPlay(app.redis, request.user.sub, request.body),
      );
      // 201 even when the score is rejected: the submission WAS recorded (as a
      // rejected play). `accepted: false` in the body is the outcome, not an
      // HTTP-level error — the request itself was perfectly valid.
      return reply.code(201).send(result);
    },
  );
}
