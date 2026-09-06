# Phase 2 — Defend this

## The shape of a backend

1. **Why can't the frontend talk to MongoDB directly?**
   There would be no authentication, no validation, and no anti-cheat — anyone
   could read every user record and rewrite their own score. The API exists to be
   the gatekeeper. In production the database ports are not reachable at all.

2. **What are the four files in a module, and what does each know?**
   `model` = how data is stored · `schemas` = the public contract ·
   `service` = business logic, knows the DB but not HTTP · `routes` = HTTP only.
   ([ADR 0007](decisions/0007-module-layering.md))

3. **Why must services never take `reply`?**
   Phase 7 calls them from background jobs and Phase 8 from WebSocket handlers,
   neither of which has one. Logic that requires `reply` can only run over HTTP.

4. **Where does validation happen, and what does that buy the handler?**
   Fastify validates against the route's Zod schema *before* the handler runs, so
   `request.body` is already typed and trusted. The handlers contain no defensive
   checks at all.

## The two subtle ones

5. **Why isn't the update schema just `createSchema.partial()`?** ← *the real bug*
   `.partial()` makes fields optional but **keeps `.default()`**. A PATCH of only
   `title` therefore re-injected every default and overwrote them — verified: the
   score ceiling silently reverted 500 → 1000, with a 200 response. Defaults are
   right on create and wrong on update.
   ([ADR 0008](decisions/0008-api-schemas-separate-from-models.md))

6. **Why does `createGame` not check whether the slug exists first?**
   Check-then-insert is a race — two concurrent requests can both pass the check.
   Only the unique index can decide atomically, so we insert and map error 11000
   to a 409. ([ADR 0009](decisions/0009-cursor-pagination.md))

7. **Why cursor pagination instead of `?page=N`?**
   `skip` breaks when rows are inserted mid-paging (items skipped or repeated), and
   `skip(100000)` walks and discards 100,000 documents. A cursor is an index seek —
   same cost on page 1 and page 10,000.

8. **Why does the list query fetch `limit + 1` rows?**
   If the extra row exists there is another page — no `countDocuments()` needed,
   which would be a collection scan on every request.

## Data modeling

9. **Why is `passwordHash` marked `select: false`, and why is `email` missing from the user response?**
   Defence in depth: the hash is not returned unless explicitly requested, and
   email is personal data that has no place in a public profile. Phase 3 adds an
   authenticated `/me` that returns your own email.

10. **In the index `{isActive: 1, createdAt: -1}`, why is that field order required?**
    The equality filter must precede the sort field, or MongoDB cannot serve the
    filter and sort from one index and falls back to an in-memory sort. Check with
    `.explain("executionStats")` and compare `totalDocsExamined` to `nReturned`.

11. **What is CORS, and why can an endpoint work in curl but fail in the browser?**
    CORS is enforced by the *browser*, not the server. curl and Postman ignore it
    entirely. Dev allows any origin; Phase 12 must use an explicit allow-list,
    because `origin: true` together with `credentials: true` is a real vulnerability.

## Verified in this phase
- `POST /games` → 201 with `Location` header; `GET /games` → cursor-paginated list
- `GET /games/:slug` → 200 · `PATCH` → 200 · `DELETE` → 204
- Duplicate slug → **409** `DUPLICATE_KEY` (from the unique index, not a pre-check)
- Invalid body → **400** with per-field details
- Unknown game → **404**; unknown route → **404** in the same shape
- Partial-update regression: PATCH of only `title` preserves `maxPlausibleScorePerSecond: 500`
- Indexes present in Mongo: `slug_1 UNIQUE`, `isActive_1_createdAt_-1`
- OpenAPI explorer at `/docs` lists all 9 endpoints
