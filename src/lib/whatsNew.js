/**
 * Group newest-first items by age for the "What's new" page.
 * Pure: `now` is injectable so the buckets are testable.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECENCY_BUCKETS = Object.freeze([
  { key: 'week', title: 'This week', maxDays: 7 },
  { key: 'month', title: 'Earlier this month', maxDays: 30 },
  { key: 'older', title: 'Older', maxDays: Infinity },
]);

function ageDays(createdAt, now) {
  const t = new Date(createdAt).getTime();
  return Number.isNaN(t) ? Infinity : (now - t) / DAY_MS;
}

/** Sort newest first, then split into non-empty buckets. */
export function groupByRecency(items, now = Date.now()) {
  const sorted = [...items].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const groups = RECENCY_BUCKETS.map((b) => ({ ...b, items: [] }));
  for (const item of sorted) {
    const age = ageDays(item.createdAt, now);
    const bucket = groups.find((g) => age < g.maxDays) || groups.at(-1);
    bucket.items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}
