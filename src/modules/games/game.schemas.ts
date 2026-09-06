import { z } from 'zod';

/**
 * Zod schemas describing the HTTP contract.
 *
 * These are deliberately separate from the Mongoose schema. The database model
 * is internal; this is the public API. Keeping them apart means you can add an
 * internal field without leaking it to clients, and change storage without
 * breaking the frontend.
 */

// Lowercase letters, digits and hyphens only — safe in a URL without encoding.
const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric words separated by hyphens');

export const gameParamsSchema = z.object({ slug });

/**
 * Field definitions WITHOUT defaults, so create and update can apply different
 * rules to the same fields.
 */
const gameFields = {
  title: z.string().min(1).max(120),
  description: z.string().max(2_000),
  scoreDirection: z.enum(['higher', 'lower']),
  maxPlausibleScorePerSecond: z.number().positive().max(1_000_000_000),
};

// On create, defaults are correct: an omitted field should get a sensible value.
export const createGameSchema = z.object({
  slug,
  title: gameFields.title,
  description: gameFields.description.optional(),
  scoreDirection: gameFields.scoreDirection.default('higher'),
  maxPlausibleScorePerSecond: gameFields.maxPlausibleScorePerSecond.default(1_000),
});

/**
 * On update, defaults are WRONG and were an actual bug.
 *
 * `createGameSchema.partial()` looks right but is not: `.partial()` makes fields
 * optional yet leaves `.default()` in place. Parsing `{title:"X"}` therefore
 * produced `{title, scoreDirection:"higher", maxPlausibleScorePerSecond:1000}`,
 * and the PATCH wrote all three — silently resetting fields the client never
 * sent. Verified: a PATCH of only `title` reverted the score ceiling 500 -> 1000.
 *
 * So the update schema is built from the default-free field definitions, and
 * `slug` is excluded because it is the game's public identity — changing it
 * would break every existing link.
 */
export const updateGameSchema = z
  .object({
    title: gameFields.title,
    description: gameFields.description,
    scoreDirection: gameFields.scoreDirection,
    maxPlausibleScorePerSecond: gameFields.maxPlausibleScorePerSecond,
  })
  .partial();

export const listGamesQuerySchema = z.object({
  // z.coerce because query strings are always strings — "20" must become 20.
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Cursor pagination, not offset: with ?page=N, rows inserted while a user
  // pages cause items to be skipped or repeated. A cursor is a stable position.
  cursor: z.string().optional(),
  activeOnly: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const gameResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  scoreDirection: z.enum(['higher', 'lower']),
  maxPlausibleScorePerSecond: z.number(),
  isActive: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const listGamesResponseSchema = z.object({
  items: z.array(gameResponseSchema),
  // null when there are no more pages.
  nextCursor: z.string().nullable(),
});

export type CreateGameInput = z.infer<typeof createGameSchema>;
export type UpdateGameInput = z.infer<typeof updateGameSchema>;
export type ListGamesQuery = z.infer<typeof listGamesQuerySchema>;
