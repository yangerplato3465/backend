import type { FastifyInstance } from 'fastify';

type CheckResult = 'ok' | 'fail';

/**
 * Liveness and readiness are NOT the same thing, and conflating them is one of
 * the most common Kubernetes mistakes. See docs/decisions/0003.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Liveness — "is this process alive and not deadlocked?"
   * If this fails, Kubernetes RESTARTS the pod.
   *
   * It deliberately checks nothing external. If it pinged Mongo, then a Mongo
   * outage would restart every pod in a loop — turning a recoverable dependency
   * failure into a self-inflicted outage.
   */
  app.get('/healthz', async () => ({
    status: 'ok',
    uptime: Math.round(process.uptime()),
  }));

  /**
   * Readiness — "can this pod serve traffic right now?"
   * If this fails, Kubernetes removes the pod from the Service's endpoints but
   * leaves it running, so it can recover and rejoin automatically.
   *
   * Dependency checks belong HERE, and must return a non-2xx status when they
   * fail — a probe reads the status code, not the body.
   */
  app.get('/readyz', async (_request, reply) => {
    const checks: Record<string, CheckResult> = {};

    // An actual round trip. `readyState` alone would lie: it reports the
    // driver's belief about the connection, not whether the server answers.
    try {
      const db = app.mongo.connection.db;
      if (!db) throw new Error('no database handle');
      await db.admin().ping();
      checks.mongo = 'ok';
    } catch (err) {
      app.log.warn({ err }, 'readiness: mongo check failed');
      checks.mongo = 'fail';
    }

    try {
      await app.redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      app.log.warn({ err }, 'readiness: redis check failed');
      checks.redis = 'fail';
    }

    const ready = Object.values(checks).every((c) => c === 'ok');

    if (!ready) {
      return reply.code(503).send({ status: 'not_ready', checks });
    }

    return reply.send({ status: 'ready', checks });
  });
}
