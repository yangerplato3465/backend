import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './config/env.js';
import { healthRoutes } from './plugins/health.js';

/**
 * Builds the app WITHOUT starting a listener.
 *
 * This split (build vs. listen) is deliberate: tests can call
 * `app.inject({ method: 'GET', url: '/healthz' })` to exercise real routing and
 * serialization with no network port and no race conditions. It is the single
 * most useful structural decision for testability in a Fastify project.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const isDev = env.NODE_ENV === 'development';

  // Built conditionally rather than passing `transport: undefined`, because
  // `exactOptionalPropertyTypes` in tsconfig treats an explicit undefined as an error.
  // pino-pretty is dev-only: in production we emit newline-delimited JSON, which is
  // what log aggregators (and `kubectl logs`) expect.
  const logger = isDev
    ? {
        level: env.LOG_LEVEL,
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      }
    : { level: env.LOG_LEVEL };

  const app = Fastify({
    logger,
    // Trust an inbound x-request-id so a single request can be traced across
    // services; Fastify generates one when the header is absent.
    requestIdHeader: 'x-request-id',
    // Behind an ingress/load balancer, the client IP arrives in X-Forwarded-For.
    // Without this, rate limiting in Phase 6 would limit the load balancer itself.
    trustProxy: true,
  });

  await app.register(healthRoutes);

  return app;
}
