# Arcade Arena — Game Platform Backend

## Context

You are a game/frontend developer (Godot, PixiJS, Phaser slot games, React Native, TypeScript) with no backend experience yet. You want to learn backend development, MongoDB, Redis, Docker, and Kubernetes, build a frontend against it later, and end up with something that strengthens your resume.

`/Users/user/Projects/backend` is empty — this is greenfield.

**Why this project.** A generic CRUD app would let you *list* MongoDB/Redis/Docker/K8s on a resume without being able to justify any of them. A multiplayer game platform makes each one load-bearing: leaderboards are the textbook case for Redis sorted sets, live matches force pub/sub fan-out, and pub/sub fan-out only matters because the API runs as multiple pods. Each technology has a reason to exist that you can defend in an interview. It also builds on the domain you already know, and it ends in a clickable live demo you can wire one of your existing PixiJS/Godot games into.

**Decisions made:** Node + TypeScript · full realtime (WebSockets + matchmaking) · **turn-based server-authoritative matches** · local `kind` cluster then a live cloud deploy · I write the code, you read along.

**Cost:** Phases 0–11 are $0 (all local). Phase 12 is $0–7/month. See [Costs](#costs).

**Mode note.** Because you are not writing the code, the main risk is not being able to speak to it later. Two mitigations are built into every phase: a `docs/decisions/` ADR explaining *why* each choice was made, and a "defend this" checklist of questions you should be able to answer before moving on. Treat those checklists as the actual deliverable — the code is the artifact, the understanding is the point.

---

## Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **Fastify** | Fast, first-class TypeScript, schema validation and pino logging built in. Express is older and teaches more boilerplate than concepts. |
| DB driver | **Mongoose** | Schemas/validation/indexes teach data modeling explicitly; also what most job postings name. |
| Redis | **ioredis** | Best Lua, pipeline, and cluster support. |
| Validation | **Zod** + `fastify-type-provider-zod` | One schema drives runtime validation, TS types, and OpenAPI. Types shareable with your future frontend. |
| Auth | **argon2** + JWT access/refresh | Argon2 is the current password-hashing recommendation over bcrypt. |
| Jobs | **BullMQ** | Redis-backed; reuses infra you already run. |
| Tests | **Vitest** + Fastify `.inject()` + **testcontainers** | Real Mongo/Redis in tests, no mocks lying to you. |
| Metrics | **prom-client** | Makes K8s HPA driven by real signals. |

---

## Redis usage map (the resume centerpiece)

This is the part worth memorizing — it is what separates you from "I added a cache."

| Key / channel | Type | Purpose |
|---|---|---|
| `lb:global:{gameId}` | ZSET | All-time board. `ZADD GT` keeps only a player's personal best. |
| `lb:daily:{gameId}:{yyyymmdd}` | ZSET + TTL | Daily board that expires itself — no cleanup job needed. |
| `lb:weekly:{gameId}:{isoWeek}` | ZSET + TTL | Same pattern, different window. |
| — | `ZREVRANK` | "You are #4,213 of 900k" in O(log N). **The reason Redis is here and not Mongo.** |
| `play:nonce:{nonce}` | STRING NX | One-shot play tokens — anti-cheat replay prevention. |
| `refresh:{userId}:{jti}` | STRING + TTL | Refresh-token rotation with reuse detection. |
| `ratelimit:{ip}:{route}` | ZSET + Lua | Sliding-window limiter, atomic in one round trip. |
| `mm:queue:{gameId}` | ZSET | Matchmaking queue scored by skill, widening by wait time. |
| `lock:match:{matchId}` | SET NX PX | Distributed lock so two pods can't apply moves concurrently. |
| `match:state:{matchId}` | HASH + TTL | Authoritative board state, lives in Redis **not pod memory** — this is what keeps pods stateless and lets any pod serve any move. |
| `cache:game:{slug}` | STRING + TTL | Cache-aside with explicit invalidation on write. |
| `events:leaderboard:{gameId}` | Pub/Sub | Fan out score changes to WS clients **on other pods**. |
| `events:match:{matchId}` | Pub/Sub | Same, for live match state. |

The last two are the crux: a WebSocket client is connected to exactly one pod, but the event that concerns them may be produced on any pod. Pub/sub is what makes horizontal scaling possible — which is why Kubernetes belongs in this project at all.

---

## Data model (MongoDB)

- **users** — email (unique idx), passwordHash, displayName, roles[], createdAt
- **games** — slug (unique idx), title, scoreDirection (`higher`|`lower`), maxPlausibleScorePerSecond, config
- **plays** — userId, gameId, nonce, startedAt, submittedAt, score, valid, rejectionReason · compound idx `{gameId, userId, score}`
- **tournaments** — gameId, name, startAt, endAt, status, rules, prizes · idx `{status, startAt}`
- **tournamentEntries** — tournamentId, userId, bestScore, playCount · unique compound idx `{tournamentId, userId}`
- **matches** — gameId, players[], moves[] (full ordered log), startedAt, endedAt, result, winnerId · idx `{players.userId, endedAt}`

The move log matters: replaying it must reproduce the final state exactly. That makes matches auditable, makes reconnection trivial, and is the answer to "how do you know a result is legitimate?"

Mongo is the source of truth; **Redis is a derived index that can always be rebuilt from `plays`.** Build a `rebuildLeaderboards` script early — it proves the invariant and it is a great interview answer to "what if Redis dies?"

---

## Phases

Each phase is a milestone: it ends with something runnable, an ADR in `docs/decisions/`, and a "defend this" checklist.

**Phase 0 — Tooling.** Install via Homebrew: OrbStack (lighter than Docker Desktop on Apple Silicon), `kubectl`, `kind`, `helm`, `mongosh`, `redis-cli`, `gh`. Scaffold pnpm + TypeScript + Fastify, `git init`, `/healthz`.

**Phase 1 — Docker.** `docker-compose.yml` with API + MongoDB + Redis, hot reload, multi-stage `Dockerfile` (non-root user, small final image). *You learn: images vs containers, volumes, service networking.*

**Phase 2 — Data modeling.** Mongoose schemas, indexes, Zod-validated CRUD for users and games, centralized error handling. *You learn: schema design, indexes, why validation happens at the edge.*

**Phase 3 — Auth.** Argon2 hashing, short-lived JWT access tokens, refresh-token rotation in Redis with reuse detection, RBAC guards. *You learn: why not sessions, why rotation, what reuse detection catches.*

**Phase 4 — Score submission + anti-cheat.** Server-issued signed play tokens; on submit verify nonce is unused (`SET NX`), not expired, and that score/elapsed-time is plausible. Idempotency keys. *This is the feature that makes the project non-generic.*

**Phase 5 — Redis leaderboards.** ZSETs, `ZADD GT`, `ZREVRANK`, daily/weekly TTL keys, pagination, cache-aside for profiles, plus the rebuild script.

**Phase 6 — Rate limiting.** Sliding window as a Lua script. *You learn: why atomicity needs Lua and not read-then-write.*

**Phase 7 — Tournaments.** CRUD, entry rules, BullMQ jobs to open/close tournaments and finalize standings. *You learn: background jobs, retries, idempotent workers.*

**Phase 8 — Realtime, server-authoritative matches.** `@fastify/websocket`: live leaderboard subscriptions, matchmaking queue, and match rooms where **the server owns the board**.

The reference game is **Connect Four** — trivial rules, real win-condition logic, short matches that demo well. It sits behind a `GameRules` interface (`validateMove`, `applyMove`, `checkTerminal`), so swapping in another turn-based game later is a new implementation, not a rewrite. That interface is what keeps the platform multi-game.

The design constraint that makes this interesting: **pods must stay stateless.** So a move is: acquire `lock:match:{id}` → load state from Redis → validate it's that player's turn and the move is legal → apply → persist state + append to the Mongo move log → publish to `events:match:{id}` → release. Clients never send state, only intent — an illegal or out-of-turn move is rejected server-side, so cheating is structurally impossible rather than merely detected.

Also covers reconnection (rehydrate from Redis, or replay the Mongo move log), turn timeouts via BullMQ, and forfeit handling. *You learn: authoritative state, optimistic vs authoritative clients, why the lock is required, idempotent move handling.*

Verify by running two API containers behind a load balancer: two players on **different pods** must see a consistent board.

**Phase 9 — Tests + docs + CI.** Vitest with testcontainers, OpenAPI via `@fastify/swagger`, GitHub Actions running lint/typecheck/test.

**Phase 10 — Observability.** Structured pino logs with request IDs, prom-client metrics, `/healthz` vs `/readyz` (liveness vs readiness — they are not the same), graceful shutdown on SIGTERM. *Prerequisite for K8s behaving correctly.*

**Phase 11 — Kubernetes (local kind).** Deployment, Service, Ingress, ConfigMap, Secret, resource requests/limits, liveness+readiness probes, HPA on CPU and custom metrics. Mongo and Redis as StatefulSets locally. Scale to 3 replicas and re-verify the Phase 8 cross-pod test.

**Phase 12 — Cloud deploy.** k3s on a small VPS (~$5–10/mo) or a managed cluster; managed Mongo Atlas free tier + managed Redis to avoid running stateful workloads yourself; cert-manager for TLS; GitHub Actions building and pushing images and triggering a rollout. Ends with a live HTTPS URL.

**Phase 13 — Frontend hookup.** Small Vite + TS client: auth, leaderboards, and a playable Connect Four board over WebSockets. Optionally wire an existing PixiJS/Godot-web game in as a second game to prove the platform is genuinely multi-game. Final README with an architecture diagram.

---

## Costs

**Phases 0–11: $0.** Containers, MongoDB, Redis, and the `kind` cluster all run locally. All of the Kubernetes learning happens here at no cost.

**Phase 12 is the only phase that can cost money**, because a public URL needs an always-on machine.

| Item | Free path | Cheap paid path |
|---|---|---|
| MongoDB | Atlas **M0** — 512 MB, free indefinitely | — (M0 suffices) |
| Redis | Redis Cloud (~30 MB) or Upstash free tier | ~$5–10/mo |
| Compute / cluster | Oracle Cloud **Always Free** ARM instance + k3s | Hetzner ~€4/mo, DigitalOcean/Vultr ~$6/mo |
| TLS | Let's Encrypt via cert-manager | — |
| Registry | GitHub Container Registry (public images) | — |
| CI | GitHub Actions (free for public repos) | — |
| Domain | `nip.io` / DuckDNS subdomain | ~$10–15/**year** |

Realistic total: **$0/mo** on Oracle's free tier, **~$5–7/mo** on the more reliable path, plus an optional ~$12/year domain.

**Cost traps to avoid:**
- **Managed K8s control planes** — EKS bills ~$73/mo for the control plane alone. Single-node k3s teaches the same material for ~$5.
- **`type: LoadBalancer` Services** — each provisions a real cloud load balancer at ~$10–20/mo. On k3s use the bundled ingress instead; a copy-pasted manifest can cost more than the server.
- **Free *trial* credits** ($300 GCP/Azure) expire and then bill silently — prefer *always-free* tiers over trials.
- Set a **$5 billing alert** on day one with any provider.

Pricing changes; verify at Phase 12 rather than now.

---

## Verification

- **Per phase:** `docker compose up`, then exercise the new endpoints via the OpenAPI UI at `/docs`; `mongosh` and `redis-cli` to inspect actual stored state (do this by hand — watching keys appear is most of the learning).
- **Leaderboards:** seed ~100k synthetic plays, confirm `ZREVRANK` rank lookups stay sub-millisecond, then drop Redis and rebuild from Mongo to prove the invariant.
- **Anti-cheat:** replay a used nonce, submit an implausible score, submit an expired token — all three must be rejected with distinct reasons.
- **Cross-pod realtime:** scale to 3 replicas, connect a WS client, submit a score through a different pod, assert the client receives it. Run this both in Compose and in kind.
- **Server authority:** from a raw WS client, send an out-of-turn move, an illegal column, and a duplicate move — all must be rejected without mutating state. Kill the pod mid-match and confirm the other pod resumes the board correctly from Redis.
- **Kubernetes:** `kubectl rollout restart` with no dropped requests (graceful shutdown works); kill a pod and confirm probes recycle it; load-test to watch the HPA scale up.
- **CI:** every push runs typecheck, lint, and integration tests against real containerized Mongo/Redis.

## Open items

- Project/repo name — `arcade-arena` is the working title, easy to change before Phase 0.
- Cloud provider and hosting choice for Phase 12 — decide at that point, once you know the real resource needs.
