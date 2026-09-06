import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },

    // `select: false` keeps the hash out of query results unless explicitly
    // asked for with .select('+passwordHash'). Defence in depth: forgetting to
    // strip it in one serializer no longer leaks it.
    // Optional until Phase 3, which adds registration and argon2 hashing.
    passwordHash: { type: String, select: false },

    roles: { type: [String], default: ['player'] },
  },
  { timestamps: true },
);

// Case-insensitive uniqueness. Without the collation, "Bob@x.com" and
// "bob@x.com" would be two accounts — a classic account-takeover vector.
// `lowercase: true` above normalises on write; this enforces it at the index.
userSchema.index({ email: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;

export const UserModel = model('User', userSchema);
