# syntax=docker/dockerfile:1

# Multi-stage build. The goal is that the FINAL image contains only production
# dependencies and compiled JavaScript — no TypeScript, no compiler, no dev tools.
# That shrinks the image and, more importantly, shrinks the attack surface.

########################  base  ########################
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH"
RUN corepack enable
WORKDIR /app

########################  deps (dev + prod)  ########################
# Copied separately from source so this layer is cached and only re-runs when
# the manifest or lockfile changes — not on every source edit.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

########################  dev (used by docker compose)  ########################
# Source is bind-mounted at runtime, so it is deliberately NOT copied in here.
FROM deps AS dev
COPY tsconfig.json ./
CMD ["pnpm", "dev"]

########################  build  ########################
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

########################  prod dependencies only  ########################
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

########################  runtime  ########################
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini as PID 1. Node running as PID 1 only receives signals it has explicitly
# registered a handler for — so a SIGTERM arriving while Node is still loading
# modules (before our handler exists) is silently DISCARDED and the container
# hangs until SIGKILL. Verified: without this, "docker stop" reproducibly took
# the full grace period and exited 137.
#
# With tini as PID 1, Node runs as a normal child with default signal
# dispositions, so an early SIGTERM terminates it instead of hanging. tini also
# reaps orphaned zombies. See docs/decisions/0006.
RUN apk add --no-cache tini

# `node` (uid 1000) already exists in the official image. Running as a non-root
# user means a container escape does not start as root, and it is required by
# most hardened Kubernetes admission policies (Phase 11).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist         ./dist
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# Exec form (not shell form): a shell-form CMD would put /bin/sh between tini
# and node, and sh does not forward signals to its child.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
