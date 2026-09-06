# 0006 — Run tini as PID 1

**Status:** accepted · Phase 1
**Supersedes part of [0004](0004-graceful-shutdown.md)**

## The bug this fixes
Phase 0 verified graceful shutdown by running `node dist/server.js` on macOS: SIGTERM
exited 0 and drained. That verification was **insufficient**, because it did not test
the app as PID 1 in a container.

In the container, `docker stop` reproducibly (3/3 runs) took the **full 15s grace
period** and exited **137 (SIGKILL)** — the exact opposite of a graceful shutdown.

## Root cause
PID 1 is special. The kernel does **not** apply default signal dispositions to it: a
process running as PID 1 only receives signals it has **explicitly registered a
handler for**. Every other signal is silently discarded.

Node was PID 1. A SIGTERM arriving before `process.on('SIGTERM', ...)` executed was
therefore thrown away, and the container sat until SIGKILL.

That window is not small. It covers:
1. Node loading modules (fastify, mongoose, ioredis — hundreds of ms), and
2. `await buildApp()` connecting to Mongo and Redis.

## Two fixes, both needed
**1. Register handlers before any async work** (`src/server.ts`). This closes the
`buildApp()` half of the window. Necessary but **not sufficient** — it cannot close
window (1), since no application code has run yet during module loading.

**2. tini as PID 1** (`ENTRYPOINT ["/sbin/tini", "--"]`). tini becomes PID 1 and Node
becomes an ordinary child, so normal signal dispositions apply again: an early
SIGTERM terminates Node instead of vanishing. tini also reaps orphaned zombies.

`docker-compose.yml` sets `init: true` on the dev service for the same reason
(there the tree is pnpm -> tsx -> node).

## Verified
| Scenario | Before | After |
|---|---|---|
| SIGTERM during startup | **137** after 15s hang (3/3) | **143**, immediate (3/3) |
| SIGTERM once fully booted | 0, drained | **0, drained** (unchanged) |

143 is correct here: the process is killed before it can serve traffic, so there is
nothing to drain. What matters is that it exits *immediately* instead of hanging.

## Why this matters in production
Kubernetes sends SIGTERM to starting pods routinely — an aborted rollout, a failed
readiness gate, a scale-down during a deploy. Without this, every such pod would
occupy its full `terminationGracePeriodSeconds` (default 30s) doing nothing, making
deploys and rollbacks drag.

## Defend this
> "Your app handles SIGTERM. Why do you still need tini?"

Because handlers only exist once the app's code has run. As PID 1 there are no
default dispositions, so any signal arriving during module loading is discarded and
the container hangs to SIGKILL. tini is PID 1 from process start, so the window
never exists. Handling signals in-app and running an init are complementary, not
alternatives.

> "How did you find it?"

Testing shutdown against the container, not the host binary. The host test passed
and hid the bug — because on the host, Node is not PID 1.
