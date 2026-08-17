import type { AtlasFeatureProperties, Place } from "./types";

export type DrawnFeature = {
  id: string;
  name: string;
  kind: Place["kind"];
  domainId: string;
  fieldId?: string | null;
  subfieldId?: string | null;
  worksCount: number;
  path: string;
  ring: number[][];
  lon: number;
  lat: number;
};

const DOMAIN_COLORS: Record<string, { fill: string; coast: string; glow: string }> = {
  "domain:3": { fill: "#3a2a18", coast: "#e8872a", glow: "rgba(232, 135, 42, 0.28)" },
  "domain:1": { fill: "#2a2214", coast: "#c47a28", glow: "rgba(196, 122, 40, 0.26)" },
  "domain:4": { fill: "#3a1c12", coast: "#d4622a", glow: "rgba(212, 98, 42, 0.26)" },
  "domain:2": { fill: "#3d2c12", coast: "#e09a32", glow: "rgba(224, 154, 50, 0.28)" },
};

export function domainPaint(domainId: string) {
  return DOMAIN_COLORS[domainId] ?? DOMAIN_COLORS["domain:3"];
}

export function shadeHex(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const adj = (channel: number) => Math.max(0, Math.min(255, channel + amount));
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function featureTint(id: string, base: string): string {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const delta = ((hash >>> 0) % 36) - 12;
  return shadeHex(base, delta);
}

export function ringToPath(ring: number[][]): string {
  if (ring.length < 3) return "";
  return `${ring
    .map(([lon, lat], index) => `${index === 0 ? "M" : "L"}${lon.toFixed(3)},${(-lat).toFixed(3)}`)
    .join(" ")} Z`;
}

export function featuresFromCollection(
  collection: GeoJSON.FeatureCollection<GeoJSON.Polygon, AtlasFeatureProperties>,
): DrawnFeature[] {
  return collection.features.flatMap((feature) => {
    if (feature.geometry?.type !== "Polygon") return [];
    const ring = feature.geometry.coordinates?.[0];
    if (!ring) return [];
    const path = ringToPath(ring);
    if (!path) return [];
    const props = feature.properties;
    return [
      {
        id: props.id,
        name: props.name,
        kind: props.kind,
        domainId: props.domainId,
        fieldId: props.fieldId,
        subfieldId: props.subfieldId,
        worksCount: props.worksCount ?? 0,
        path,
        ring,
        lon: ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
        lat: ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
      },
    ];
  });
}

export function featureAtPoint(
  layers: DrawnFeature[][],
  lon: number,
  lat: number,
  allow?: (feature: DrawnFeature) => boolean,
): DrawnFeature | null {
  for (const layer of layers) {
    let best: DrawnFeature | null = null;
    let bestArea = Infinity;
    for (const feature of layer) {
      if (allow && !allow(feature)) continue;
      if (feature.ring.length < 3 || !pointInRing(lon, lat, feature.ring)) continue;
      const area = ringArea(feature.ring);
      if (area < bestArea) {
        best = feature;
        bestArea = area;
      }
    }
    if (best) return best;
  }
  return null;
}

function ringArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(area) / 2;
}

export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
