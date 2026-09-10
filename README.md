# Arcade Arena — Game Platform Backend

A multiplayer game platform backend: authentication, anti-cheat score submission,
Redis-backed leaderboards, tournaments, and server-authoritative real-time matches.

Built as a structured learning project covering **Node/TypeScript, MongoDB, Redis,
Docker, and Kubernetes** — where each technology is load-bearing rather than decorative.

## Status

Phase 5 of 13 complete — Redis sorted-set leaderboards with self-expiring daily
and weekly windows, and a rebuild script proving Redis is a derived index.

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
| `pnpm rebuild:leaderboards` | Rebuild every Redis board from MongoDB |

## Endpoints

| Route | Purpose |
|---|---|
| `GET /healthz` | Liveness — process alive. Checks no dependencies (see [ADR 0003](docs/decisions/0003-liveness-vs-readiness.md)) |
| `GET /readyz` | Readiness — pings Mongo and Redis; **503** with a per-dependency breakdown if either is down |
| `GET /docs` | Interactive OpenAPI explorer — the fastest way to see the contract |
| `GET /games` | List games, cursor-paginated (`?limit=&cursor=&activeOnly=`) |
| `POST /games` | Create a game → 201 |
| `GET /games/:slug` | Fetch one game |
| `PATCH /games/:slug` | Partial update |
| `DELETE /games/:slug` | Delete → 204 |
| `POST /auth/register` | Create an account → 201 with a token pair |
| `POST /auth/login` | Credentials → access + refresh token |
| `POST /auth/refresh` | Rotate the refresh token (single-use) |
| `POST /auth/logout` | Revoke a whole token family → 204 |
| `GET /auth/me` | The authenticated user (requires Bearer token) |
| `POST /plays/start` | Begin a play, receive a single-use play token |
| `POST /plays/submit` | Submit a score against that token (anti-cheat checked) |
| `GET /games/:slug/leaderboard` | Ranked scores (`?window=global\|daily\|weekly`) |
| `GET /games/:slug/leaderboard/me` | Your own rank — O(log N) via ZREVRANK |
| `GET /users` | List users |
| `GET /users/:id` | Public profile (no email, no password hash) |

### Error shape

Every error returns the same JSON, so a client never special-cases per endpoint:

```json
{ "error": "NotFoundError", "code": "NOT_FOUND",
  "message": "Game 'tetris' not found", "requestId": "req-5" }
```

`code` is the stable field to branch on. 5xx responses deliberately carry no
internal detail — that goes to the logs.

## Layout

```
src/
  config/env.ts      Zod-validated environment, fails fast at boot
  plugins/mongo.ts   Mongoose connection, exposed as app.mongo
  plugins/redis.ts   ioredis connection, exposed as app.redis
  plugins/health.ts  Liveness + readiness
  shared/errors.ts   Typed errors services throw without knowing about HTTP
  shared/error-handler.ts  Turns any thrown value into one consistent response
  plugins/auth.ts    JWT verification, app.authenticate, app.requireRoles
  modules/games/     model | schemas | service | routes  (see ADR 0007)
  modules/users/     same layering
  modules/auth/      password hashing, refresh-token store, auth service/routes
  modules/plays/     play tokens, anti-cheat validation, play history
  modules/leaderboards/   sorted-set boards, UTC day/week bucketing
  scripts/rebuild-leaderboards.ts   rebuilds all boards from MongoDB
  shared/idempotency.ts   run an operation at most once per (user, key)
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
- **Role changes need a new token.** Roles are read from the access token, not the
  database, so a promotion takes effect on the next login or refresh (≤15 min).
  ([ADR 0011](docs/decisions/0011-token-strategy.md))
- **`JWT_SECRET` has no default.** The app refuses to boot without one of at least
  32 characters. Compose sets a dev-only value; Phase 11 injects a real Secret.
