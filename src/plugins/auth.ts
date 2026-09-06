import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { env } from '../config/env.js';
import { ForbiddenError, UnauthorizedError } from '../shared/errors.js';

/** The claims we put in an access token. Keep it small — it travels on every request. */
export interface AccessTokenPayload {
  sub: string; // user id
  roles: string[];
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenPayload;
    user: AccessTokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler: rejects the request unless a valid access token is present. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** preHandler factory: authenticate, then require one of these roles. */
    requireRoles: (...roles: string[]) => preHandlerHookHandler;
    signAccessToken: (payload: AccessTokenPayload) => string;
  }
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.ACCESS_TOKEN_TTL },
  });

  app.decorate('signAccessToken', (payload: AccessTokenPayload) => app.jwt.sign(payload));

  /**
   * Verifies the `Authorization: Bearer <token>` header.
   *
   * Roles are read from the TOKEN, not the database, so a normal request costs
   * zero database round trips — that is the whole appeal of a stateless token.
   * The trade-off: a role change does not take effect until the access token
   * expires, which is exactly why access tokens are short-lived (15m).
   */
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      // Deliberately generic. Saying "expired" vs "malformed" vs "bad signature"
      // tells an attacker which part of their forgery attempt to fix.
      throw new UnauthorizedError('Missing or invalid access token');
    }
  });

  app.decorate('requireRoles', (...roles: string[]): preHandlerHookHandler => {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      await app.authenticate(request, reply);
      const userRoles = request.user.roles ?? [];
      if (!roles.some((role) => userRoles.includes(role))) {
        // 403, not 404: they are authenticated, just not allowed.
        throw new ForbiddenError(`Requires one of: ${roles.join(', ')}`);
      }
    };
  });
}

export default fp(authPlugin, { name: 'auth' });
