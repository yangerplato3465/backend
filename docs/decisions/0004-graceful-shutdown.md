# 0004 — Handle SIGTERM for zero-downtime deploys

**Status:** accepted · Phase 0

## Decision
`src/server.ts` traps SIGINT/SIGTERM and calls `app.close()` to drain in-flight
requests before exiting. A `shuttingDown` guard makes a second signal a no-op.

## Why
Kubernetes terminates a pod by sending SIGTERM, then waiting
(`terminationGracePeriodSeconds`, default 30s) before SIGKILL. Node's default
SIGTERM behaviour is immediate death — so without this handler, **every rolling
deploy severs whatever requests were in flight.**

This is the mechanism behind the Phase 11 check "`kubectl rollout restart` with no
dropped requests."

## Verified (host only — superseded, see the correction below)
Running the compiled output and sending SIGTERM exits **0** and logs both
`shutdown signal received` and `shutdown complete`.

Note: under `tsx watch` in development the same test exits **143** and logs neither,
because the dev wrapper does not forward the signal to its child. This is a dev-tool
artifact, not an app bug — the container runs `node dist/server.js`, which is the
path that was verified.

## Defend this
> "Your dev server exits 143 on Ctrl-C. Is shutdown broken?"

No — that is the `tsx` supervisor, not the app. The production entrypoint is
`node dist/server.js`, which drains correctly and exits 0. Always test shutdown
against the artifact you actually ship.

## Correction (Phase 1)
The verification above was **insufficient**. It tested `node dist/server.js` on
macOS, where Node is not PID 1. In a container Node *is* PID 1, and the same test
failed: `docker stop` hung for the full grace period and exited 137.

See [0006](0006-tini-pid1-signals.md). Two changes were required: registering signal
handlers before any async startup work, and running tini as PID 1.

Lesson: verify shutdown in the same process topology you ship, not merely the same
binary.
