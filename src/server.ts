import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { env } from './config/env.js';

/**
 * Graceful shutdown.
 *
 * Kubernetes stops a pod by sending SIGTERM and then waiting
 * (`terminationGracePeriodSeconds`, default 30s) before SIGKILL. Ignoring
 * SIGTERM means every rolling deploy severs in-flight requests.
 *
 * CRITICAL ORDERING: the handlers are registered BEFORE any async startup work.
 *
 * A container's entrypoint runs as PID 1, and PID 1 does not get the kernel's
 * default signal dispositions — it only receives signals it has explicitly
 * handled. So if SIGTERM arrives while we are still awaiting the Mongo/Redis
 * connections, a handler registered *after* that await does not exist yet, the
 * signal is silently discarded, and the container hangs until SIGKILL.
 *
 * That is not hypothetical: registering these after `buildApp()` reproducibly
 * caused `docker stop` to take the full grace period and exit 137.
 */
let app: FastifyInstance | undefined;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  // A second Ctrl-C must not interrupt an in-progress drain.
  if (shuttingDown) return;
  shuttingDown = true;

  // Signalled before the server finished booting: there is nothing to drain,
  // and no logger yet, so leave promptly rather than hanging until SIGKILL.
  if (!app) {
    console.log(`{"msg":"${signal} received during startup, exiting"}`);
    process.exit(0);
  }

  app.log.info({ signal }, 'shutdown signal received, draining connections');

  app
    .close()
    .then(() => {
      app?.log.info('shutdown complete');
      process.exit(0);
    })
    .catch((err: unknown) => {
      app?.log.error({ err }, 'error during shutdown');
      process.exit(1);
    });
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, shutdown);
}

try {
  app = await buildApp();

  // If a signal landed while buildApp() was awaiting Mongo/Redis, don't go on to
  // start listening — the shutdown handler above has already begun exiting.
  if (!shuttingDown) {
    await app.listen({ port: env.PORT, host: env.HOST });
  }
} catch (err) {
  console.error('failed to start server:', err);
  process.exit(1);
}
