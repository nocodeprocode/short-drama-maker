function firstClause(value: string): string {
  return value.split(/\s*[—–-]\s*/)[0]?.trim().toLowerCase() ?? "";
}

function overlapScore(left: string, right: string): number {
  if (left === right) return Number.POSITIVE_INFINITY;
  if (left.startsWith(right) || right.startsWith(left) || left.includes(right) || right.includes(left)) {
    return Math.min(left.length, right.length);
  }
  return 0;
}

export function locationRefForScene(
  locationRefs: Record<string, string>,
  sceneLocation: string | null | undefined,
): string | null {
  if (!sceneLocation?.trim()) return null;
  const exact = locationRefs[sceneLocation];
  if (exact) return exact;

  const entries = Object.entries(locationRefs).filter(([, id]) => Boolean(id));
  if (entries.length === 0) return null;

  const needle = firstClause(sceneLocation);
  const byClause = entries.filter(([key]) => firstClause(key) === needle);
  if (byClause.length === 1) return byClause[0]![1];
  if (byClause.length > 1) {
    const bestClause = byClause.reduce((winner, candidate) =>
      candidate[0].length > winner[0].length ? candidate : winner,
    );
    return bestClause[1];
  }

  const lower = sceneLocation.trim().toLowerCase();
  let best: { id: string; score: number } | null = null;
  for (const [key, id] of entries) {
    const score = overlapScore(key.trim().toLowerCase(), lower);
    if (score > 0 && (!best || score > best.score)) {
      best = { id, score };
    }
  }
  return best?.id ?? null;
}

export function pinLocationToBible(sceneLocation: string, bibleLocations: string[]): string | null {
  if (bibleLocations.includes(sceneLocation)) return sceneLocation;
  const refs = Object.fromEntries(bibleLocations.map((location) => [location, location]));
  return locationRefForScene(refs, sceneLocation);
}
