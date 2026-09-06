# 0002 — Validate environment variables at boot

**Status:** accepted · Phase 0

## Decision
Parse all of `process.env` through a Zod schema in `src/config/env.ts` at startup.
Exit non-zero if anything is missing or malformed.

## Why
The alternative is reading `process.env.X` at the point of use, where a typo or a
missing value surfaces as `undefined` deep inside a request handler, far from the
real cause, and often only under load.

This matters specifically for Kubernetes: a pod that crashes instantly on a bad
ConfigMap never passes its readiness probe, so it never receives traffic and the
rollout halts with the old version still serving. **Failing fast is what makes a bad
deploy safe.** A pod that boots successfully and then 500s on every request is far
worse — it looks healthy and takes production down.

`MONGO_URI` and `REDIS_URL` are required even though nothing connects to them until
Phase 1/2, for the same reason.

## Defend this
> "Why exit instead of falling back to a default?"

Defaults hide misconfiguration. A default database URL in production is how you
silently write to the wrong database. Ports and log levels have safe defaults;
connection strings and secrets never do.
