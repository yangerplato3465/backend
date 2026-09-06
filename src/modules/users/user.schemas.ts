import { z } from 'zod';

export const userParamsSchema = z.object({ id: z.string() });

export const listUsersQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

/**
 * The public shape of a user.
 *
 * Note what is absent: `passwordHash`, and `email`. Email is personal data and
 * has no business being in a public profile — leaking it via a leaderboard is a
 * real privacy bug. Phase 3 adds a separate authenticated `/me` route that does
 * return the caller's own email.
 */
export const userResponseSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
  createdAt: z.iso.datetime(),
});

export const listUsersResponseSchema = z.object({
  items: z.array(userResponseSchema),
  nextCursor: z.string().nullable(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
