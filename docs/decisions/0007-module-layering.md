# 0007 — Layer each module: routes → service → model

**Status:** accepted · Phase 2

## Decision
Every feature is a folder with four files:

```
src/modules/games/
  game.model.ts     Mongoose schema + indexes   (how data is stored)
  game.schemas.ts   Zod request/response schemas (the public contract)
  game.service.ts   Business logic               (knows the DB, not HTTP)
  game.routes.ts    HTTP handlers                (knows HTTP, not the DB)
```

## Why
The rule is that **services never touch `request` or `reply`.** They take plain
arguments and return plain data, throwing typed errors from `shared/errors.ts`.

That buys three things:

1. **Reuse.** Phase 7 calls services from BullMQ jobs and Phase 8 from WebSocket
   handlers. Neither has a `reply` object. Logic that took one could not be reused.
2. **Testability.** A service test is a function call — no fake request needed.
3. **One error path.** Services throw `NotFoundError`; a single handler maps it to
   404. Every endpoint returns the same error shape without repeating itself.

The common failure mode this avoids is business logic accumulating inside route
handlers until the only way to run it is over HTTP.

## Defend this
> "Isn't this over-engineering for a CRUD endpoint?"

For one endpoint, yes. The structure pays off the first time logic needs a second
caller — a scheduled job, a WebSocket message, a CLI script. Retrofitting it later
means untangling `reply` calls from business rules across every route.
