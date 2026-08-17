import type { Atlas, EntityKind, Place, PlaceKind } from "./types";

export function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function jitter(
  lon: number,
  lat: number,
  id: string,
  scale = 0.45,
): { lon: number; lat: number } {
  const h = hash32(id);
  const angle = ((h % 360) / 360) * Math.PI * 2;
  const r = (((h >>> 9) % 1000) / 1000) * scale;
  const cos = Math.cos((lat * Math.PI) / 180) || 0.2;
  return {
    lon: lon + (Math.cos(angle) * r) / cos,
    lat: lat + Math.sin(angle) * r,
  };
}

export function indexPlaces(atlas: Atlas): Map<string, Place> {
  return new Map(atlas.places.map((place) => [place.id, place]));
}

export function ancestors(place: Place, byId: Map<string, Place>): Place[] {
  const path: Place[] = [];
  let current: Place | undefined = place;
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    path.unshift(current);
    guard.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function searchPlaces(atlas: Atlas, query: string, limit = 8): Place[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const scored = atlas.places
    .map((place) => {
      const name = place.name.toLowerCase();
      let score = 0;
      if (name === q) score = 1000;
      else if (name.startsWith(q)) score = 700;
      else if (name.includes(q)) score = 400;
      else {
        const words = name.split(/[\s,/()-]+/);
        if (words.some((word) => word.startsWith(q))) score = 320;
      }
      if (!score) return null;
      const kindBoost =
        place.kind === "field" ? 80 : place.kind === "subfield" ? 50 : place.kind === "domain" ? 40 : 10;
      const sizeBoost = Math.log10((place.worksCount || 1) + 10);
      return { place, score: score + kindBoost + sizeBoost };
    })
    .filter((row): row is { place: Place; score: number } => Boolean(row))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.place);
  return scored;
}

export function zoomForKind(kind: EntityKind): number {
  switch (kind) {
    case "domain":
      return 2.15;
    case "field":
    case "institution":
    case "source":
      return 3.45;
    case "subfield":
      return 4.5;
    case "topic":
      return 6.2;
    case "work":
      return 8.4;
    case "author":
      return 9.2;
    default:
      return 3.8;
  }
}

/** Fit the clicked piece so its next layer of pieces and their names stay on screen. */
export function cameraForPlace(
  atlas: Atlas,
  place: Place,
  viewport?: { width: number; height: number },
): { lon: number; lat: number; zoom: number } {
  const ring = ringForPlace(atlas, place);
  let lon = place.lon;
  let lat = place.lat;
  let spanLon = Math.max((place.radius || 1) * 2.2, 1.2);
  let spanLat = spanLon;

  if (ring && ring.length >= 3) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [x, y] of ring) {
      if (x < minLon) minLon = x;
      if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y;
      if (y > maxLat) maxLat = y;
    }
    lon = (minLon + maxLon) / 2;
    lat = (minLat + maxLat) / 2;
    spanLon = Math.max((maxLon - minLon) * 1.16, 0.5);
    spanLat = Math.max((maxLat - minLat) * 1.16, 0.4);
  }

  const view = viewport ?? { width: 760, height: 680 };
  const zoomLon = Math.log2((view.width * 360) / (256 * spanLon));
  const zoomLat = Math.log2((view.height * 360) / (256 * spanLat));
  const floor =
    place.kind === "domain" ? 2.15 : place.kind === "field" ? 3.25 : place.kind === "subfield" ? 4.35 : place.kind === "topic" ? 5.9 : 3.8;
  const cap =
    place.kind === "domain" ? 3.05 : place.kind === "field" ? 4.65 : place.kind === "subfield" ? 5.55 : place.kind === "topic" ? 7.2 : 11;
  const zoom = Math.max(floor, Math.min(cap, Math.min(zoomLon, zoomLat)));

  return { lon, lat, zoom };
}

function ringForPlace(atlas: Atlas, place: Place): number[][] | null {
  const pack =
    place.kind === "domain"
      ? atlas.geojson.domains
      : place.kind === "field"
        ? atlas.geojson.fields
        : place.kind === "subfield"
          ? atlas.geojson.subfields
          : place.kind === "topic"
            ? atlas.geojson.topics
            : null;
  const feature = pack?.features.find((row) => row.properties?.id === place.id);
  const ring = feature?.geometry?.coordinates?.[0];
  return ring && ring.length >= 3 ? ring : null;
}

export function locatePlace(
  byId: Map<string, Place>,
  topicId?: string | null,
  subfieldId?: string | null,
  fieldId?: string | null,
  domainId?: string | null,
): Place | null {
  const keys = [topicId, subfieldId, fieldId, domainId].filter(Boolean) as string[];
  for (const key of keys) {
    const hit = byId.get(key);
    if (hit) return hit;
  }
  return null;
}

export function nearestPlace(atlas: Atlas, lon: number, lat: number, kind?: PlaceKind): Place | null {
  let best: Place | null = null;
  let bestD = Infinity;
  for (const place of atlas.places) {
    if (kind && place.kind !== kind) continue;
    if (place.kind === "topic") continue;
    const d = (place.lon - lon) ** 2 + (place.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = place;
    }
  }
  return best;
}

export function placeAtZoom(atlas: Atlas, lon: number, lat: number, zoom: number): Place | null {
  const kind: PlaceKind = zoom >= 4.2 ? "subfield" : zoom >= 2.4 ? "field" : "domain";
  return nearestPlace(atlas, lon, lat, kind) ?? nearestPlace(atlas, lon, lat);
}

function planarDistance(lon: number, lat: number, place: Place): number {
  const cos = Math.cos((lat * Math.PI) / 180) || 0.2;
  const dx = (place.lon - lon) * cos;
  const dy = place.lat - lat;
  return Math.hypot(dx, dy);
}

export function placeAtPoint(
  atlas: Atlas,
  lon: number,
  lat: number,
  zoom: number,
  allow?: (place: Place) => boolean,
): Place | null {
  const kinds: PlaceKind[] =
    zoom >= 5
      ? ["topic", "subfield", "field", "domain"]
      : zoom >= 3.4
        ? ["subfield", "field", "domain"]
        : zoom >= 2
          ? ["field", "domain"]
          : ["domain", "field"];

  let best: Place | null = null;
  let bestScore = Infinity;
  for (const place of atlas.places) {
    if (!kinds.includes(place.kind)) continue;
    if (allow && !allow(place)) continue;
    const distance = planarDistance(lon, lat, place);
    const reach =
      place.radius > 0
        ? place.radius * 1.35
        : place.kind === "domain"
          ? 22
          : place.kind === "field"
            ? 8
            : 2.4;
    if (distance > reach) continue;
    const kindBias =
      place.kind === "topic" ? 0 : place.kind === "subfield" ? 0.8 : place.kind === "field" ? 2.2 : 6;
    const score = distance + kindBias;
    if (score < bestScore) {
      bestScore = score;
      best = place;
    }
  }
  return best;
}
