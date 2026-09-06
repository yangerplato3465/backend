# 0003 — Separate liveness (`/healthz`) from readiness (`/readyz`)

**Status:** accepted · Phase 0 (dependency checks land in Phase 10)

## Decision
Two endpoints with different meanings:

| Endpoint | Question | K8s action on failure | Checks dependencies? |
|---|---|---|---|
| `/healthz` | Is the process alive? | **Restarts** the pod | **No** |
| `/readyz` | Can it serve traffic now? | **Removes from Service endpoints**, keeps running | **Yes** |

## Why
Conflating them is a classic outage amplifier. If the liveness probe pinged MongoDB,
then a brief Mongo blip would fail liveness on *every* pod at once, so Kubernetes
would restart the entire fleet — converting a recoverable dependency hiccup into a
total outage, and a crash-loop that prevents recovery.

Readiness is the correct place for dependency checks: an unready pod is pulled out
of load balancing but stays alive, so it rejoins automatically once Mongo returns.

## Defend this
> "What actually breaks if you check the database in the liveness probe?"

A dependency outage becomes a restart storm. Pods restart, lose warm caches and
connection pools, all reconnect simultaneously, and the thundering herd keeps the
dependency down. The blast radius goes from degraded to dead.
