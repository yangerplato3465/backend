import { Types } from 'mongoose';
import { UserModel, type UserDocument } from './user.model.js';
import type { ListUsersQuery } from './user.schemas.js';
import { BadRequestError, NotFoundError } from '../../shared/errors.js';

function toDto(user: UserDocument) {
  return {
    id: user._id.toString(),
    displayName: user.displayName,
    roles: user.roles,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function getUserById(id: string) {
  // Validate before querying: passing a malformed id to Mongoose throws a
  // CastError, which would surface as a 500. A bad id is a client mistake (400).
  if (!Types.ObjectId.isValid(id)) throw new BadRequestError('Invalid user id');

  const user = await UserModel.findById(id);
  if (!user) throw new NotFoundError('User', id);
  return toDto(user);
}

export async function listUsers(query: ListUsersQuery) {
  const filter: Record<string, unknown> = {};

  if (query.cursor) {
    if (!Types.ObjectId.isValid(query.cursor)) throw new BadRequestError('Invalid cursor');
    filter._id = { $lt: new Types.ObjectId(query.cursor) };
  }

  const docs = await UserModel.find(filter).sort({ _id: -1 }).limit(query.limit + 1);
  const hasMore = docs.length > query.limit;
  const items = hasMore ? docs.slice(0, query.limit) : docs;

  return {
    items: items.map(toDto),
    nextCursor: hasMore ? (items.at(-1)?._id.toString() ?? null) : null,
  };
}
