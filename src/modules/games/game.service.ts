import { Types } from 'mongoose';
import { GameModel, type GameDocument } from './game.model.js';
import type { CreateGameInput, UpdateGameInput, ListGamesQuery } from './game.schemas.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';

/**
 * Business logic. Knows about the database, knows nothing about HTTP.
 *
 * That separation is what lets these functions be called from a route today, a
 * background job in Phase 7, and a WebSocket handler in Phase 8 — and be unit
 * tested without constructing a fake request.
 */

/** Convert a database document into the public API shape. */
function toDto(game: GameDocument) {
  return {
    // The frontend sees `id`, never Mongo's `_id`.
    id: game._id.toString(),
    slug: game.slug,
    title: game.title,
    description: game.description ?? '',
    scoreDirection: game.scoreDirection,
    maxPlausibleScorePerSecond: game.maxPlausibleScorePerSecond,
    isActive: game.isActive,
    createdAt: game.createdAt.toISOString(),
    updatedAt: game.updatedAt.toISOString(),
  };
}

export async function createGame(input: CreateGameInput) {
  // No "does this slug exist?" check first. That would be a check-then-act race:
  // two concurrent requests could both pass the check and both insert. Instead
  // we let the unique index decide, and the error handler maps Mongo's 11000
  // duplicate-key error to a 409. The database is the only place that can
  // enforce this atomically.
  // `description` is optional in the API but always a string in the database.
  // Normalising here (rather than passing `undefined` through) keeps the stored
  // shape consistent and satisfies exactOptionalPropertyTypes.
  const game = await GameModel.create({
    ...input,
    description: input.description ?? '',
  });
  return toDto(game);
}

export async function getGameBySlug(slug: string) {
  const game = await GameModel.findOne({ slug });
  if (!game) throw new NotFoundError('Game', slug);
  return toDto(game);
}

export async function listGames(query: ListGamesQuery) {
  const filter: Record<string, unknown> = {};
  if (query.activeOnly) filter.isActive = true;

  // Cursor = the _id of the last item on the previous page. Because ObjectIds
  // are monotonically increasing, "_id < cursor" means "older than that item",
  // which pairs exactly with sorting newest-first.
  if (query.cursor) {
    if (!Types.ObjectId.isValid(query.cursor)) {
      throw new BadRequestError('Invalid cursor');
    }
    filter._id = { $lt: new Types.ObjectId(query.cursor) };
  }

  // Fetch one extra row: if it comes back, there is at least one more page.
  // This avoids a second count query, which would be a full scan on large data.
  const docs = await GameModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1);

  const hasMore = docs.length > query.limit;
  const items = hasMore ? docs.slice(0, query.limit) : docs;

  return {
    items: items.map(toDto),
    nextCursor: hasMore ? (items.at(-1)?._id.toString() ?? null) : null,
  };
}

export async function updateGame(slug: string, input: UpdateGameInput) {
  const game = await GameModel.findOneAndUpdate(
    { slug },
    { $set: input },
    // `new` returns the updated document rather than the pre-update one.
    // `runValidators` is required because schema validation does NOT run on
    // update operations by default — a genuine Mongoose footgun.
    { new: true, runValidators: true },
  );
  if (!game) throw new NotFoundError('Game', slug);
  return toDto(game);
}

export async function deleteGame(slug: string) {
  const result = await GameModel.deleteOne({ slug });
  if (result.deletedCount === 0) throw new NotFoundError('Game', slug);
}
