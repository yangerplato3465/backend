import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';

import { env } from './config/env.js';
import { registerErrorHandler } from './shared/error-handler.js';
import { healthRoutes } from './plugins/health.js';
import mongoPlugin from './plugins/mongo.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';
import { gameRoutes } from './modules/games/game.routes.js';
import { userRoutes } from './modules/users/user.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { playRoutes } from './modules/plays/play.routes.js';
import { leaderboardRoutes } from './modules/leaderboards/leaderboard.routes.js';

/**
 * Builds the app WITHOUT starting a listener, so tests can drive it with
 * `app.inject()` — no network port, no port-collision races.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const isDev = env.NODE_ENV === 'development';

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
    requestIdHeader: 'x-request-id',
    trustProxy: true,
  });

  // Teach Fastify to validate requests and serialize responses using the Zod
  // schemas attached to each route. One schema now drives three things:
  // runtime validation, TypeScript types, and the OpenAPI document below.
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  registerErrorHandler(app);

  /**
   * CORS — the browser rule that decides whether your frontend may call this API.
   *
   * A browser refuses cross-origin responses unless the server opts in, so
   * without this every fetch() from a frontend on a different port fails. Note
   * it is enforced by the BROWSER, not the server: curl and Postman ignore CORS
   * entirely, which is why an endpoint can work in the terminal and still fail
   * in the browser.
   *
   * Dev allows any origin for convenience. Phase 12 must replace this with an
   * explicit allow-list — `origin: true` with credentials is a real vulnerability.
   */
  await app.register(cors, {
    origin: isDev ? true : ['https://example.com'],
    credentials: true,
  });

  // Generates an OpenAPI document from the same Zod schemas, and serves an
  // interactive explorer at /docs. This is the fastest way for a frontend
  // developer (you, later) to see exactly what the API accepts and returns.
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Arcade Arena API',
        description: 'Game platform backend: games, users, scores, leaderboards.',
        version: '0.1.0',
      },
      servers: [{ url: `http://localhost:${env.PORT}` }],
      components: {
        securitySchemes: {
          // Lets the /docs explorer send an Authorization header, so protected
          // routes are testable from the browser.
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Infrastructure first: these decorate app.mongo / app.redis, which the
  // routes registered afterwards depend on.
  await app.register(mongoPlugin);
  await app.register(redisPlugin);
  // Must come after redis: auth routes read app.redis for the refresh-token store.
  await app.register(authPlugin);

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(gameRoutes);
  await app.register(userRoutes);
  await app.register(playRoutes);
  await app.register(leaderboardRoutes);

  return app;
}
