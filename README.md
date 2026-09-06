# Arcade Arena — Game Platform Backend

A multiplayer game platform backend: authentication, anti-cheat score submission,
Redis-backed leaderboards, tournaments, and server-authoritative real-time matches.

Built as a structured learning project covering **Node/TypeScript, MongoDB, Redis,
Docker, and Kubernetes** — where each technology is load-bearing rather than decorative.

## Status

Phase 0 of 13 complete — tooling, scaffold, health endpoints, graceful shutdown.

Full roadmap: [`docs/roadmap.md`](docs/roadmap.md) ·
Decisions: [`docs/decisions/`](docs/decisions/)

## Stack

Fastify · MongoDB (Mongoose) · Redis (ioredis) · Zod · BullMQ · Vitest · Docker · Kubernetes

## Requirements

- Node >= 22, pnpm
- Docker/OrbStack (from Phase 1)

## Running locally

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Then:

```bash
curl localhost:3000/healthz
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
| `GET /readyz` | Readiness — can serve traffic. Dependency checks land in Phase 10 |

## Layout

```
src/
  config/env.ts      Zod-validated environment, fails fast at boot
  plugins/health.ts  Liveness + readiness
  app.ts             buildApp() — no listener, so tests can use app.inject()
  server.ts          Entrypoint: listen + graceful shutdown
docs/decisions/      Architecture decision records (the "why")
```
