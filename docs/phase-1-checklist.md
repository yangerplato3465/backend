# Phase 1 — Defend this

## Docker fundamentals

1. **Why does the API connect to `mongodb://mongo:27017`, not `localhost:27017`?**
   Each container has its own network namespace, so `localhost` means *that
   container*. Compose runs an internal DNS server that resolves service names to
   container IPs.

2. **What would break without the `mongo-data` named volume?**
   Every `docker compose down` would wipe the database. A container's writable layer
   is destroyed with the container; volumes outlive it.

3. **Why is `node_modules` NOT bind-mounted, when `src` is?**
   The container installs Linux binaries. Mounting the host's macOS `node_modules`
   over them would shadow them with binaries for the wrong platform.

4. **Why `depends_on: condition: service_healthy` rather than the default?**
   The default only waits for the container to *exist*. The API connects to Mongo
   during boot, so it needs Mongo actually accepting connections.

5. **What does the multi-stage build buy you?**
   The final image has only production dependencies and compiled JS — no TypeScript,
   no tsx, no esbuild. Measured: **268MB vs 462MB**, and a smaller attack surface.

6. **Why run as `USER node` instead of root?**
   A container escape does not begin as root, and hardened Kubernetes admission
   policies (Phase 11) reject root containers.

## The two bugs found in this phase

7. **Why is MongoDB pinned to 7.0.x?**
   MongoDB 8+ refuses to boot on Linux kernel 6.19+ (TCMalloc rseq ABI violation,
   SERVER-121912); OrbStack runs kernel 7.0.14. The documented `GLIBC_TUNABLES`
   workaround does not help — the version gate runs first.
   ([ADR 0005](decisions/0005-pin-mongodb-7.md))

8. **Why is tini PID 1 when the app already handles SIGTERM?** ← *the big one*
   PID 1 receives only signals it has explicitly handled; everything else is
   discarded. A SIGTERM arriving while Node is still loading modules therefore
   vanished, and the container hung until SIGKILL (exit 137). Handlers cannot be
   registered early enough to cover module loading, so an init process is required.
   ([ADR 0006](decisions/0006-tini-pid1-signals.md))

9. **Why did the Phase 0 shutdown test pass while the app was still broken?**
   It ran the binary on macOS, where Node is not PID 1. The bug only exists in the
   PID 1 topology. **Verify behaviour in the topology you ship.**

## Verified in this phase
- `docker compose up` brings up api + mongo + redis; API logs `mongo connected` / `redis connected`
- `/readyz` → 200 `{"mongo":"ok","redis":"ok"}`
- Redis stopped → `/readyz` **503** `{"mongo":"ok","redis":"fail"}`, `/healthz` still **200**, auto-recovers
- Hot reload: editing `src/` restarts the server inside the container
- `mongosh` and `redis-cli` reach the containers from the host
- Production image: 268MB, uid 1000, zero dev packages, PID 1 = `/sbin/tini -- node dist/server.js`
- SIGTERM during startup → exit 143 immediately (was 137 after a 15s hang)
- SIGTERM when running → exit 0 after draining
