import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Types } from 'mongoose';
import { UserModel } from '../users/user.model.js';
import { hashPassword, verifyPassword } from './password.js';
import { issueRefreshToken, revokeByToken, rotateRefreshToken } from './token.service.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import { NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { env } from '../../config/env.js';
import type { AccessTokenPayload } from '../../plugins/auth.js';

/**
 * Dependencies are passed in rather than imported, so these functions can be
 * unit-tested with a fake Redis and no HTTP server. See ADR 0007.
 */
export interface AuthDeps {
  redis: Redis;
  signAccessToken: (payload: AccessTokenPayload) => string;
}

/**
 * A real argon2 hash of a random string, computed once on first use.
 *
 * Defends against user enumeration by timing. If a login for an unknown email
 * returned immediately while a known email took ~50ms to hash, response time
 * alone would reveal which emails have accounts. Verifying against this dummy
 * makes both paths cost the same.
 *
 * It is generated rather than hard-coded on purpose: a hand-written constant
 * that is not a valid argon2 string would fail parsing almost instantly, which
 * would reintroduce exactly the timing difference this exists to remove.
 */
let dummyHashPromise: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('hex'));
  return dummyHashPromise;
}

function toAuthUser(user: { _id: Types.ObjectId; email: string; displayName: string; roles: string[] }) {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
  };
}

async function issueSession(deps: AuthDeps, user: Parameters<typeof toAuthUser>[0]) {
  const authUser = toAuthUser(user);
  return {
    accessToken: deps.signAccessToken({ sub: authUser.id, roles: authUser.roles }),
    refreshToken: await issueRefreshToken(deps.redis, authUser.id),
    expiresIn: env.ACCESS_TOKEN_TTL,
    user: authUser,
  };
}

export async function register(deps: AuthDeps, input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);

  // No "is this email taken?" pre-check — that is a race. The unique index
  // decides, and the error handler maps 11000 to a 409. See ADR 0009.
  const user = await UserModel.create({
    email: input.email,
    displayName: input.displayName,
    passwordHash,
    roles: ['player'],
  });

  return issueSession(deps, user);
}

export async function login(deps: AuthDeps, input: LoginInput) {
  // passwordHash is `select: false` on the model, so it must be asked for.
  const user = await UserModel.findOne({ email: input.email }).select('+passwordHash');

  // Always run a verification, even when the user does not exist, so both paths
  // take the same time. See getDummyHash above.
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(await getDummyHash(), input.password);

  // One message for both "no such user" and "wrong password". Distinguishing
  // them turns the login form into an account-enumeration oracle.
  if (!ok || !user) {
    throw new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
  }

  return issueSession(deps, user);
}

/** Exchange a refresh token for a new pair. The old one is burned. */
export async function refresh(deps: AuthDeps, refreshToken: string) {
  const { userId, tokenId } = await rotateRefreshToken(deps.redis, refreshToken);

  // Re-read the user so a role change or deletion takes effect at refresh time.
  // This is the point where revocation actually happens.
  const user = await UserModel.findById(userId);
  if (!user) throw new UnauthorizedError('User no longer exists', 'USER_GONE');

  const authUser = toAuthUser(user);
  return {
    accessToken: deps.signAccessToken({ sub: authUser.id, roles: authUser.roles }),
    refreshToken: tokenId,
    expiresIn: env.ACCESS_TOKEN_TTL,
    user: authUser,
  };
}

export async function logout(deps: AuthDeps, refreshToken: string): Promise<void> {
  await revokeByToken(deps.redis, refreshToken);
}

export async function getMe(userId: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw new NotFoundError('User', userId);
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
  };
}
