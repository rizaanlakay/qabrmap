// Overpass queries and conversion of OSM elements into GeoJSON rings. No network.

export function aroundQuery(lat, lng, radiusMeters = 400) {
  const around = `(around:${radiusMeters},${lat},${lng})`;
  return `[out:json][timeout:25];
(
  way["landuse"="cemetery"]${around};
  way["amenity"="grave_yard"]${around};
  relation["landuse"="cemetery"]${around};
  relation["amenity"="grave_yard"]${around};
);
out geom;`;
}

export function wayQuery(osmId) {
  const id = osmId.replace(/^way\//, '');
  return `[out:json][timeout:25];
way(${id});
out geom;`;
}

function closeRing(points) {
  const ring = points.map((p) => [p.lon, p.lat]);
  const [first] = ring;
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

// Planar shoelace on a ring in degrees; the sign is dropped
function shoelace(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(sum) / 2;
}

export function elementToRing(element) {
  if (element.type === 'way') {
    if (!Array.isArray(element.geometry) || element.geometry.length < 3) return null;
    return closeRing(element.geometry);
  }
  if (element.type === 'relation') {
    const outers = (element.members || [])
      .filter((m) => m.role === 'outer' && Array.isArray(m.geometry) && m.geometry.length >= 3)
      .map((m) => closeRing(m.geometry));
    if (outers.length === 0) return null;
    // A cemetery relation with several outers is rare; the biggest one is the cemetery
    return outers.sort((a, b) => shoelace(b) - shoelace(a))[0];
  }
  return null;
}

// Equirectangular scaling at the ring's mean latitude is accurate enough to spot a wrong outline
export function ringAreaSquareMeters(ring) {
  const meanLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((meanLat * Math.PI) / 180);
  const projected = ring.map(([lng, lat]) => [lng * mPerDegLng, lat * mPerDegLat]);
  return shoelace(projected);
}

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringCentroidDistance(ring, lng, lat) {
  const cx = ring.reduce((s, [x]) => s + x, 0) / ring.length;
  const cy = ring.reduce((s, [, y]) => s + y, 0) / ring.length;
  return Math.hypot(cx - lng, cy - lat);
}

export function chooseOutline(elements, point, preferredOsmId) {
  const outlines = elements
    .map((element) => ({ osmId: `${element.type}/${element.id}`, ring: elementToRing(element) }))
    .filter((o) => o.ring)
    .map((o) => ({
      ...o,
      areaSquareMeters: Math.round(ringAreaSquareMeters(o.ring)),
      containsPoint: ringContains(o.ring, point.lng, point.lat),
    }));
  if (outlines.length === 0) return null;
  const preferred = preferredOsmId && outlines.find((o) => o.osmId === preferredOsmId);
  if (preferred) return preferred;
  const containing = outlines.find((o) => o.containsPoint);
  if (containing) return containing;
  return outlines.sort(
    (a, b) => ringCentroidDistance(a.ring, point.lng, point.lat) - ringCentroidDistance(b.ring, point.lng, point.lat)
  )[0];
}
