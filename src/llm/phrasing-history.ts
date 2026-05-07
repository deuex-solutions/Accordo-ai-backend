/**
 * Phrasing History
 *
 * In-memory cache of recent phrasing fingerprints per deal, used by the
 * persona-renderer / fallback-templates to avoid repeating the same opener
 * or hedge across rounds in a single negotiation.
 *
 * Design notes:
 * - Pure in-memory (Node process). Lost on restart — acceptable: negotiations
 *   are short-lived and a one-off repeat after restart is a low-stakes cost.
 * - Multi-instance deployments: cache fragments per process. Documented as an
 *   accepted limitation; if it ever matters, swap the implementation for Redis
 *   without changing the public API.
 * - Bounded: TTL evicts stale deals; max-entries cap protects memory.
 *
 * Fingerprint format: first 5 words (lowercased, punctuation-stripped) joined
 * by ":" with the action type prefixed — e.g. "COUNTER|appreciate:the:quick:turnaround:on".
 * Balanced: specific enough to avoid false collisions, coarse enough that
 * minor rephrasing still trips the de-dup check.
 */

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_PHRASINGS_PER_DEAL = 20;
const MAX_DEALS = 5000;

interface DealEntry {
  fingerprints: string[]; // ordered oldest → newest
  lastTouched: number;
}

const cache: Map<string, DealEntry> = new Map();

function now(): number {
  return Date.now();
}

function evictExpired(): void {
  const cutoff = now() - TTL_MS;
  for (const [dealId, entry] of cache) {
    if (entry.lastTouched < cutoff) cache.delete(dealId);
  }
}

function evictOldestIfFull(): void {
  if (cache.size < MAX_DEALS) return;
  // Find single oldest entry — O(n), acceptable at this cap.
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (const [dealId, entry] of cache) {
    if (entry.lastTouched < oldestTime) {
      oldestTime = entry.lastTouched;
      oldestKey = dealId;
    }
  }
  if (oldestKey) cache.delete(oldestKey);
}

/**
 * Build a fingerprint from a rendered message + action type.
 * First 5 meaningful words, lowercased, punctuation-stripped.
 * 5 words distinguishes "Thank you for your proposal" from "Thank you for
 * coming back" while remaining coarse enough that minor rephrasing still de-dups.
 */
export function buildFingerprint(action: string, message: string): string {
  const words = (message || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  return `${action}|${words.join(":")}`;
}

/**
 * Build a coarse opener fingerprint from just the first 3 words.
 * Catches "I appreciate your offer" and "I appreciate your position" as
 * the same opener pattern, preventing cross-message "I appreciate..." repeats.
 */
export function buildOpenerFingerprint(action: string, message: string): string {
  const words = (message || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3);
  return `OPENER|${action}|${words.join(":")}`;
}

/**
 * Record a phrasing fingerprint for a deal.
 * Records BOTH a 5-word fingerprint (specific phrasing) and a 3-word opener
 * fingerprint (catches "I appreciate" variants across messages).
 * Idempotent for repeat fingerprints — keeps the most recent timestamp.
 */
export function recordPhrasing(
  dealId: string,
  action: string,
  message: string,
): void {
  if (!dealId || !message) return;

  evictExpired();
  evictOldestIfFull();

  const fingerprint = buildFingerprint(action, message);
  const openerFp = buildOpenerFingerprint(action, message);
  const existing = cache.get(dealId) ?? {
    fingerprints: [],
    lastTouched: now(),
  };

  // Keep only most-recent occurrence of each fingerprint
  let filtered = existing.fingerprints.filter(
    (fp) => fp !== fingerprint && fp !== openerFp,
  );
  filtered.push(fingerprint, openerFp);

  // Cap per-deal list
  const trimmed =
    filtered.length > MAX_PHRASINGS_PER_DEAL
      ? filtered.slice(filtered.length - MAX_PHRASINGS_PER_DEAL)
      : filtered;

  cache.set(dealId, { fingerprints: trimmed, lastTouched: now() });
}

/**
 * Return the list of recent phrasing fingerprints used in this deal.
 * Persona-renderer / fallback-templates pass these to the LLM (or use them
 * to filter template variants) so the next message avoids repetition.
 */
export function getPhrasings(dealId: string): string[] {
  if (!dealId) return [];
  evictExpired();
  const entry = cache.get(dealId);
  if (!entry) return [];
  return [...entry.fingerprints];
}

/**
 * True when this exact (action, first-5-words) fingerprint has been used
 * recently in this deal.
 */
export function hasRecentPhrasing(
  dealId: string,
  action: string,
  message: string,
): boolean {
  const fingerprint = buildFingerprint(action, message);
  return getPhrasings(dealId).includes(fingerprint);
}

/**
 * True when this opener pattern (action, first-3-words) has been used
 * recently in this deal. Catches "I appreciate your offer" and "I appreciate
 * your position" as the same opener.
 */
export function hasRecentOpener(
  dealId: string,
  action: string,
  message: string,
): boolean {
  const openerFp = buildOpenerFingerprint(action, message);
  return getPhrasings(dealId).includes(openerFp);
}

/**
 * Test-only helper. Not exported in production paths.
 */
export function _resetPhrasingHistoryForTests(): void {
  cache.clear();
}
