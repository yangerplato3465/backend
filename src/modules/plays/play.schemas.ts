import { z } from 'zod';

export const startPlaySchema = z.object({
  gameSlug: z.string().min(2).max(64),
});

export const startPlayResponseSchema = z.object({
  // Opaque, single-use, server-issued. The client cannot mint one.
  playToken: z.string(),
  gameSlug: z.string(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const submitPlaySchema = z.object({
  playToken: z.string().min(1),
  // Finite and bounded. Without this, `Infinity` or `1e308` sails through any
  // ratio check, because Infinity/elapsed is still Infinity and comparisons
  // against it behave in ways the plausibility maths does not expect.
  score: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
});

export const submitPlayResponseSchema = z.object({
  playId: z.string(),
  accepted: z.boolean(),
  score: z.number(),
  durationMs: z.number(),
  scorePerSecond: z.number(),
  rejectionReason: z.string().nullable(),
  // null when the score was rejected; true when it beat this player's best.
  newPersonalBest: z.boolean().nullable(),
});

export type StartPlayInput = z.infer<typeof startPlaySchema>;
export type SubmitPlayInput = z.infer<typeof submitPlaySchema>;
