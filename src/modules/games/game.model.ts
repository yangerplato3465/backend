import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A game hosted on the platform. Everything else (plays, leaderboards,
 * tournaments, matches) hangs off a game.
 */
const gameSchema = new Schema(
  {
    // Stable, URL-safe public identifier. The frontend uses /games/tetris,
    // never a raw ObjectId — slugs are readable and stay valid across reseeds.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // Does a HIGHER score win (Tetris) or a LOWER one (speedrun times)?
    // Stored per game because it decides how leaderboards sort in Phase 5.
    scoreDirection: { type: String, enum: ['higher', 'lower'], default: 'higher' },

    // Anti-cheat ceiling used in Phase 4: a score implying a higher rate than
    // this over the play's duration is implausible and gets rejected.
    maxPlausibleScorePerSecond: { type: Number, default: 1000, min: 0 },

    isActive: { type: Boolean, default: true },
  },
  {
    // Adds createdAt / updatedAt and maintains them automatically.
    timestamps: true,
  },
);

/**
 * Compound index for the common list query: active games, newest first.
 *
 * Field order matters. An equality filter (`isActive`) must come before the sort
 * field (`createdAt`), otherwise Mongo cannot use one index for both and falls
 * back to an in-memory sort. Verify with:
 *   db.games.find({isActive:true}).sort({createdAt:-1}).explain("executionStats")
 */
gameSchema.index({ isActive: 1, createdAt: -1 });

export type Game = InferSchemaType<typeof gameSchema>;
export type GameDocument = HydratedDocument<Game>;

export const GameModel = model('Game', gameSchema);
