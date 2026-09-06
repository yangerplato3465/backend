import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/**
 * Connects ioredis and exposes it as `app.redis`.
 *
 * Note `maxRetriesPerRequest: null` is NOT set here — that is required later for
 * BullMQ (Phase 7), which will get its own dedicated connection. Sharing one
 * client between the app and BullMQ is a known footgun, because BullMQ's blocking
 * commands would stall ordinary queries.
 */
async function redisPlugin(app: FastifyInstance): Promise<void> {
  const client = new Redis(env.REDIS_URL, {
    // Surface connection problems instead of queueing commands indefinitely.
    enableOfflineQueue: false,
    lazyConnect: true,
  });

  client.on('error', (err) => app.log.error({ err }, 'redis error'));

  await client.connect();
  app.log.info('redis connected');

  app.decorate('redis', client);

  app.addHook('onClose', async () => {
    await client.quit();
  });
}

export default fp(redisPlugin, { name: 'redis' });
