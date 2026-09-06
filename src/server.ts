import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = await buildApp();

/**
 * Graceful shutdown.
 *
 * Kubernetes stops a pod by sending SIGTERM and then waiting (default 30s) before
 * SIGKILL. If we ignore SIGTERM, every rolling deploy severs in-flight requests.
 * Closing the server lets Fastify drain existing connections while refusing new
 * ones — this is precisely what makes the Phase 11 "rollout with zero dropped
 * requests" check pass.
 */
let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    // Guard against a second Ctrl-C interrupting an in-progress drain.
    if (shuttingDown) return;
    shuttingDown = true;

    app.log.info({ signal }, 'shutdown signal received, draining connections');

    app
      .close()
      .then(() => {
        app.log.info('shutdown complete');
        process.exit(0);
      })
      .catch((err: unknown) => {
        app.log.error({ err }, 'error during shutdown');
        process.exit(1);
      });
  });
}

try {
  await app.listen({ port: env.PORT, host: env.HOST });
} catch (err) {
  app.log.error({ err }, 'failed to start server');
  process.exit(1);
}
