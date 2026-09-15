// Facts that can be read straight off a CSV row, with no network.

const SITE_TYPES = {
  'Dedicated Muslim cemetery': 'muslim_cemetery',
  'Historic Muslim cemetery': 'historic_cemetery',
  'Muslim section in municipal cemetery': 'muslim_section',
  'Mixed cemetery with Muslim section': 'muslim_section',
  'Mixed cemetery with Muslim graves/section': 'muslim_section',
  'Mixed cemetery with Muslim blocks': 'muslim_section',
  'Muslim burials / community cemetery': 'muslim_section',
  'Shared Muslim/Hindu cemetery': 'shared_cemetery',
};

const SITE_STATUSES = {
  active: 'active',
  historic_or_closed: 'closed',
  active_or_burial_site: 'unknown',
  historic_or_active: 'unknown',
};

export function siteTypeFor(category) {
  const type = SITE_TYPES[category.trim()];
  if (!type) throw new Error(`Unknown category: "${category}"`);
  return type;
}

export function siteStatusFor(status) {
  const mapped = SITE_STATUSES[status.trim()];
  if (!mapped) throw new Error(`Unknown status: "${status}"`);
  return mapped;
}

// Waze links carry the Google place id as ?to=place.<id>
export function placeIdFromUrl(url) {
  const match = /place\.(ChIJ[\w-]+)/.exec(url || '');
  return match ? match[1] : null;
}

// Mapcarta links name the OpenStreetMap way: https://mapcarta.com/W<id>
export function osmWayFromUrl(url) {
  const match = /mapcarta\.com\/W(\d+)/.exec(url || '');
  return match ? `way/${match[1]}` : null;
}

export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cemeteryIdFor(name) {
  return `cem_${slugify(name)}`;
}

export function rowSourceUrls(row) {
  return [row.source_url_1, row.source_url_2].filter((url) => url && url.trim());
}

// Coordinates fill blanks on matching rows; extra sites are appended and marked so they start as needs_review
export function mergeSupplements(rows, supplements) {
  const coordinates = new Map((supplements.coordinates || []).map((c) => [c.cemetery_name, c]));
  const merged = rows.map((row) => {
    const fill = coordinates.get(row.cemetery_name);
    if (!fill || (row.latitude && row.longitude)) return row;
    return {
      ...row,
      latitude: String(fill.latitude),
      longitude: String(fill.longitude),
      coordinate_source_url: fill.source_url,
    };
  });
  for (const site of supplements.extra_sites || []) {
    merged.push({ latitude: '', longitude: '', source_url_2: '', ...site, from_supplements: true });
  }
  return merged;
}
