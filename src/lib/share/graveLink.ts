// Deep links to a single grave's details view, e.g. https://qabrmap.vercel.app/?grave=grave_8660

export const GRAVE_LINK_PARAM = 'grave';

export function buildGraveShareUrl(origin: string, graveId: string): string {
  const url = new URL('/', origin);
  url.searchParams.set(GRAVE_LINK_PARAM, graveId);
  return url.toString();
}

export function getGraveIdFromUrl(href: string): string | null {
  try {
    const value = new URL(href).searchParams.get(GRAVE_LINK_PARAM)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

// Returns the path + query + hash of href with the grave param set (or removed when graveId is null),
// ready to pass to history.replaceState.
export function withGraveParam(href: string, graveId: string | null): string {
  const url = new URL(href);
  if (graveId) {
    url.searchParams.set(GRAVE_LINK_PARAM, graveId);
  } else {
    url.searchParams.delete(GRAVE_LINK_PARAM);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
