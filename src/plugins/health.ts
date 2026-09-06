import type { FastifyInstance } from 'fastify';

/**
 * Liveness and readiness are NOT the same thing, and conflating them is one of
 * the most common Kubernetes mistakes. This split matters later (Phase 11), so
 * the shape is correct from day one.
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
   * leaves it running, so it can recover and rejoin.
   *
   * This is where dependency checks DO belong. Phase 2/5 will add real Mongo and
   * Redis pings to `checks`.
   */
  app.get('/readyz', async () => ({
    status: 'ready',
    checks: {} as Record<string, 'ok' | 'fail'>,
  }));
}
