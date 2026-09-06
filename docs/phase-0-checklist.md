# Phase 0 — Defend this

Answer these out loud before moving to Phase 1. If one is shaky, re-read the linked ADR.

1. **Why is `buildApp()` separate from `listen()`?**
   So tests can call `app.inject()` against real routing with no network port or
   port-collision races. ([ADR 0001](decisions/0001-fastify-over-express.md))

2. **Why validate env at boot instead of reading `process.env` where it's needed?**
   A bad config should kill the process instantly, so the pod never becomes ready and
   the rollout stops with the old version still serving. A pod that boots and then
   500s looks healthy and takes production down. ([ADR 0002](decisions/0002-validate-env-at-boot.md))

3. **What is the difference between `/healthz` and `/readyz`?**
   Liveness failure ⇒ K8s restarts the pod. Readiness failure ⇒ K8s pulls it from
   the Service but leaves it running. ([ADR 0003](decisions/0003-liveness-vs-readiness.md))

4. **Why must the liveness probe NOT check MongoDB?**
   A Mongo blip would fail liveness on every pod at once, restarting the whole fleet
   and turning a recoverable dependency failure into a crash-loop outage.

5. **What does trapping SIGTERM buy you?**
   In-flight requests drain instead of being severed, which is what makes rolling
   deploys zero-downtime. ([ADR 0004](decisions/0004-graceful-shutdown.md))

6. **Why is `trustProxy: true` set, and what breaks later without it?**
   Behind an ingress, the real client IP is in `X-Forwarded-For`. Without it, the
   Phase 6 rate limiter would bucket everyone under the load balancer's IP — so one
   abusive client would rate-limit all users.

7. **Why does `.gitignore` exclude `.env` but commit `.env.example`?**
   The example documents which variables exist without leaking their values.

## Verified in this phase
- `GET /healthz` → 200 `{"status":"ok","uptime":N}`
- `GET /readyz` → 200 `{"status":"ready","checks":{}}`
- Unknown route → 404 with a structured JSON error body
- `node dist/server.js` + SIGTERM → exit 0, logs drain messages
