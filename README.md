# Arcade Arena — Game Platform Backend

A multiplayer game platform backend: authentication, anti-cheat score submission,
Redis-backed leaderboards, tournaments, and server-authoritative real-time matches.

Built as a structured learning project covering **Node/TypeScript, MongoDB, Redis,
Docker, and Kubernetes** — where each technology is load-bearing rather than decorative.

## Status

Phase 1 of 13 complete — Dockerized stack (API + MongoDB + Redis), real readiness
checks, multi-stage production image.

Full roadmap: [`docs/roadmap.md`](docs/roadmap.md) ·
Decisions: [`docs/decisions/`](docs/decisions/)

## Stack

Fastify · MongoDB (Mongoose) · Redis (ioredis) · Zod · BullMQ · Vitest · Docker · Kubernetes

## Requirements

- Node >= 22, pnpm
- Docker/OrbStack (from Phase 1)

## Running locally

Everything runs in Docker — no local MongoDB or Redis install needed:

```bash
docker compose up --build
```

Then:

```bash
curl localhost:3000/readyz
```

Mongo (`:27017`) and Redis (`:6379`) are published to the host so you can inspect
real state, which is most of the learning:

```bash
mongosh mongodb://localhost:27017/arcade_arena
```

Running the API directly on the host instead (needs Mongo and Redis reachable):

```bash
pnpm install && cp .env.example .env && pnpm dev
```

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server with hot reload (tsx watch) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled output — this is what the container runs |
| `pnpm typecheck` | Types only, no emit |

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness — process alive. Checks no dependencies (see [ADR 0003](docs/decisions/0003-liveness-vs-readiness.md)) |
| `GET /readyz` | Readiness — pings Mongo and Redis; **503** with a per-dependency breakdown if either is down |

## Layout

```
src/
  config/env.ts      Zod-validated environment, fails fast at boot
  plugins/mongo.ts   Mongoose connection, exposed as app.mongo
  plugins/redis.ts   ioredis connection, exposed as app.redis
  plugins/health.ts  Liveness + readiness
  app.ts             buildApp() — no listener, so tests can use app.inject()
  server.ts          Entrypoint: signals registered before boot, then listen
Dockerfile           Multi-stage; runtime is 268MB, non-root, tini as PID 1
docker-compose.yml   api + mongo + redis, hot reload, healthchecks
docs/decisions/      Architecture decision records (the "why")
```

## Notes for the unwary

- **MongoDB is pinned to 7.0.x.** MongoDB 8+ refuses to start on Linux kernel 6.19+
  and OrbStack runs 7.x. ([ADR 0005](docs/decisions/0005-pin-mongodb-7.md))
- **tini is PID 1.** Without it, SIGTERM during startup is discarded and the
  container hangs until SIGKILL. ([ADR 0006](docs/decisions/0006-tini-pid1-signals.md))
