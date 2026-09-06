# 0008 — Keep API schemas separate from database models

**Status:** accepted · Phase 2

## Decision
Zod schemas (`*.schemas.ts`) define the HTTP contract. Mongoose schemas
(`*.model.ts`) define storage. They are written separately and mapped by an
explicit `toDto()` function in the service.

## Why
Auto-serialising a database document is convenient and wrong:

- **It leaks fields.** `passwordHash` and internal flags reach the client the moment
  someone adds them to the model. The user model marks `passwordHash` as
  `select: false`, and `userResponseSchema` also omits `email` — personal data with
  no place in a public profile.
- **It couples storage to the contract.** Renaming a column becomes a breaking API
  change, so schema changes get avoided rather than made.
- **`_id` is an implementation detail.** Clients get `id` as a string.

Writing `toDto()` by hand is a few lines, and it makes every exposed field a
deliberate choice.

## The bug this prevented (found in this phase)
The update schema was first written as `createGameSchema.partial().omit({slug:true})`.
That looks obviously correct and is not: **`.partial()` makes fields optional but
leaves `.default()` intact.**

Parsing a PATCH body of `{"title":"X"}` produced:

```json
{"title":"X","scoreDirection":"higher","maxPlausibleScorePerSecond":1000}
```

so the handler wrote all three fields. Verified against the running API: a PATCH of
only `title` silently reset the score ceiling from **500 back to 1000** — data loss
on every partial update, with a 200 response.

The fix separates field definitions from defaults: create applies defaults, update
does not. Defaults are correct on create ("no value given, use a sensible one") and
wrong on update ("no value given, don't touch it").

## Defend this
> "Why not derive one schema from the other?"

Because create and update have genuinely different rules on the same fields, and
because the mechanism that makes derivation look easy — `.partial()` — silently
keeps defaults, which turns an omitted field into an overwrite.
