# 0001 — Fastify over Express

**Status:** accepted · Phase 0

## Decision
Use Fastify as the HTTP framework.

## Why
- **Schema-first.** Fastify validates and serializes from JSON Schema, so validation
  is declarative rather than a pile of hand-written `if` checks. Combined with Zod
  (Phase 2), one schema produces runtime validation, TypeScript types, and OpenAPI docs.
- **Logging included.** pino ships built in, with per-request ids. Express needs
  morgan/winston bolted on, and the wiring is a distraction from the concepts.
- **`app.inject()`.** Routes can be exercised in tests with no network port. This is
  why `buildApp()` and `listen()` are separate functions.
- **TypeScript-native.** Express types are community-maintained and awkward.

## Cost
Smaller ecosystem than Express, and most Stack Overflow answers assume Express.
Accepted: the concepts transfer, and translating an Express answer to Fastify is
itself useful practice.

## Defend this
> "Why not Express? It's the industry standard."

Express is the most *common*, not the most *instructive*. Fastify's schema
validation and built-in structured logging teach the ideas — contract-first APIs,
observability — that transfer to any framework in any language.
