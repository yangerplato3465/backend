import fp from 'fastify-plugin';
import mongoose from 'mongoose';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    mongo: typeof mongoose;
  }
}

/**
 * Connects Mongoose and exposes it as `app.mongo`.
 *
 * Wrapped in `fastify-plugin` (fp) so the decorator lands on the ROOT instance.
 * Without fp, Fastify gives each plugin its own encapsulated scope and
 * `app.mongo` would be invisible to sibling plugins — the single most common
 * Fastify gotcha.
 */
async function mongoPlugin(app: FastifyInstance): Promise<void> {
  mongoose.set('strictQuery', true);

  await mongoose.connect(env.MONGO_URI, {
    // Fail fast instead of buffering forever behind an unreachable server.
    serverSelectionTimeoutMS: 5_000,
  });

  app.log.info('mongo connected');
  app.decorate('mongo', mongoose);

  // onClose runs during app.close(), i.e. inside the SIGTERM drain from Phase 0.
  app.addHook('onClose', async () => {
    await mongoose.disconnect();
  });
}

export default fp(mongoPlugin, { name: 'mongo' });
