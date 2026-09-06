# 0003 — Separate liveness (`/healthz`) from readiness (`/readyz`)

**Status:** accepted · Phase 0; real dependency checks added in Phase 1

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

## Update (Phase 1)
`/readyz` now performs real round trips — `db.admin().ping()` and `redis.ping()` —
and returns **503** with a per-dependency breakdown when any fails. A probe reads the
status code, so returning 200 with a "failing" body would be invisible to Kubernetes.

Mongoose's `readyState` alone was rejected: it reports the driver's *belief* about the
connection, not whether the server actually answers.

Verified by stopping Redis: `/readyz` returned 503 `{"mongo":"ok","redis":"fail"}`
while `/healthz` stayed **200** — so Kubernetes would pull the pod from load
balancing without restarting it, and it rejoined automatically once Redis returned.
