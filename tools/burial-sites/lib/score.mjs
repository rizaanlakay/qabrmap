// Ranks Google Places candidates for one CSV row. No network.

const EARTH_RADIUS_M = 6_371_000;
// A row's own coordinates are trusted to a kilometre; a town centre only to thirty
export const ANCHOR_LIMITS = { row: 1000, town: 30_000 };
const FILLER = new Set(['muslim', 'cemetery', 'maqbara', 'road', 'street', 'the', 'of', 'and', 'in', 'municipal', 'public', 'old', 'new']);

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nameTokens(name) {
  return name
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !FILLER.has(token));
}

// Score: up to 1 for closeness, up to 1 for shared name words, 0.5 for being a cemetery. Null when too far.
export function scoreCandidate({ csvName, anchor, anchorKind, candidate }) {
  if (!candidate.location) return null;
  const limit = ANCHOR_LIMITS[anchorKind];
  const distance = haversineMeters(anchor.lat, anchor.lng, candidate.location.latitude, candidate.location.longitude);
  if (distance > limit) return null;
  const wanted = nameTokens(csvName);
  const got = new Set(nameTokens(candidate.displayName || ''));
  const overlap = wanted.length ? wanted.filter((t) => got.has(t)).length / wanted.length : 0;
  const isCemetery = (candidate.types || []).includes('cemetery') ? 0.5 : 0;
  return 1 - distance / limit + overlap + isCemetery;
}

export function rankCandidates(row, anchor, anchorKind, candidates) {
  return candidates
    .filter((candidate) => candidate.location)
    .map((candidate) => ({
      candidate,
      score: scoreCandidate({ csvName: row.cemetery_name, anchor, anchorKind, candidate }),
      distanceMeters: haversineMeters(anchor.lat, anchor.lng, candidate.location.latitude, candidate.location.longitude),
    }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
