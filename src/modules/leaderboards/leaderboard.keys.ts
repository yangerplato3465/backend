/**
 * Leaderboard key naming and time windows.
 *
 * All windows are computed in UTC. Using server-local time would silently shift
 * every boundary when the deployment region changes, and would make two pods in
 * different zones disagree about which day it is.
 */

export type Window = 'global' | 'daily' | 'weekly';

/** YYYYMMDD in UTC. */
export function dayBucket(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * ISO-8601 week: YYYY-Www. Weeks start Monday, and the week containing the
 * year's first Thursday is week 1 — which is why this is not just
 * "day-of-year / 7". Getting it wrong makes boards jump around near New Year.
 */
export function weekBucket(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Shift to the Thursday of this week, then count weeks from Jan 1.
  const dayNum = d.getUTCDay() || 7; // Sunday = 7, not 0
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function leaderboardKey(window: Window, gameId: string, now = new Date()): string {
  switch (window) {
    case 'global':
      return `lb:global:${gameId}`;
    case 'daily':
      return `lb:daily:${gameId}:${dayBucket(now)}`;
    case 'weekly':
      return `lb:weekly:${gameId}:${weekBucket(now)}`;
  }
}

/**
 * TTLs for the time-boxed boards.
 *
 * This is the reason daily and weekly boards need no cleanup job at all: the key
 * name encodes its period, and Redis deletes it when the period is well past.
 * Tomorrow's board is simply a different key that springs into existence on the
 * first write. Doing this in MongoDB would mean a scheduled purge and a
 * `WHERE createdAt BETWEEN ...` scan on every read.
 *
 * The grace period is deliberate — a board stays readable for a while after its
 * window closes, so "yesterday's winners" can still be displayed.
 */
export const WINDOW_TTL_SECONDS: Record<Exclude<Window, 'global'>, number> = {
  daily: 60 * 60 * 48, // 2 days
  weekly: 60 * 60 * 24 * 14, // 2 weeks
};
