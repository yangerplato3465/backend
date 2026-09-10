import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * One attempt at a game: issued by /plays/start, completed by /plays/submit.
 *
 * REJECTED PLAYS ARE STORED TOO (`accepted: false` plus a reason). Throwing them
 * away would discard the most valuable signal there is — a user with 200 rejected
 * submissions is a cheater, and you cannot see that pattern if you only keep the
 * successes. It is also the audit trail for "why was my score not counted?".
 */
const playSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    gameId: { type: Schema.Types.ObjectId, ref: 'Game', required: true },

    // The one-time token issued at /plays/start. Kept for auditing after the
    // Redis entry has expired.
    nonce: { type: String, required: true },

    startedAt: { type: Date, required: true },
    submittedAt: { type: Date, required: true },
    durationMs: { type: Number, required: true },

    score: { type: Number, required: true },

    accepted: { type: Boolean, required: true },
    rejectionReason: { type: String },

    // What the score implied, kept so thresholds can be re-tuned later against
    // real data rather than guesses.
    scorePerSecond: { type: Number, required: true },
  },
  { timestamps: true },
);

/**
 * The leaderboard query in Phase 5: "best accepted scores for this game".
 * `accepted` and `gameId` are equality filters so they precede the sort field —
 * same index-ordering rule as ADR 0007's note on games.
 */
playSchema.index({ gameId: 1, accepted: 1, score: -1 });

/** "My play history", newest first. */
playSchema.index({ userId: 1, createdAt: -1 });

/**
 * A nonce may be recorded at most once. Redis prevents double-submission while
 * the token is live; this is the durable backstop if Redis is ever flushed.
 */
playSchema.index({ nonce: 1 }, { unique: true });

export type Play = InferSchemaType<typeof playSchema>;
export type PlayDocument = HydratedDocument<Play>;

export const PlayModel = model('Play', playSchema);
