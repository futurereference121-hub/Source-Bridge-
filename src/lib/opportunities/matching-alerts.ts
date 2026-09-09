/**
 * MATCHING ALERT ARCHITECTURE BLOCKER (Opportunities)
 *
 * Targeted matching alerts (buyer request ↔ nearby sourcer / travel destination
 * overlap / etc.) require a safe bounded background mechanism.
 *
 * Current safe mechanisms in this repo:
 * - Request-path synchronous work (follower notify on create)
 * - Bounded Vercel crons with hard take limits (stories, payments, live cleanup,
 *   opportunities-reconcile for expiry/pre-expiry renew nudges only)
 *
 * What is NOT available / NOT allowed:
 * - General job queue
 * - Ably as a job queue
 * - Unapproved paid providers
 * - Global fan-out / notify-everyone
 * - Per-user or per-card polling for matches
 * - Web Push (deferred)
 *
 * Therefore: MATCHING ALERT ARCHITECTURE BLOCKER for proactive targeted match
 * notifications. For You relevance scoring still runs at read time.
 *
 * Pre-expiry “Still available? Renew opportunity” uses the bounded
 * /api/cron/opportunities-reconcile path and is NOT blocked.
 */
export const MATCHING_ALERT_ARCHITECTURE_BLOCKER = true as const;
