import { z } from 'zod';

/**
 * Password policy: length only.
 *
 * Composition rules ("must contain a symbol") push people toward `Password1!`
 * and are explicitly discouraged by NIST SP 800-63B. Length is what actually
 * resists guessing. The upper bound exists because argon2 hashing cost scales
 * with input, so an unbounded password is a cheap denial-of-service.
 */
const password = z.string().min(10, 'must be at least 10 characters').max(200);

export const registerSchema = z.object({
  email: z.email().max(254),
  displayName: z.string().min(2).max(40),
  password,
});

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string(),
    displayName: z.string(),
    roles: z.array(z.string()),
  }),
});

export const meResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
