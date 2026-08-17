import { Delaunay } from "d3-delaunay";
import { ringToPath } from "./geo";

export type TessellatedCell<T> = T & {
  lon: number;
  lat: number;
  path: string;
  ring: number[][];
};

export function fillItemsInRing<T extends { id: string; citedByCount?: number }>(
  items: T[],
  parent: number[][],
): TessellatedCell<T>[] {
  const raw = ring(parent);
  const clip = ring(convexHull(raw));
  if (!items.length || clip.length < 3) return [];

  const ranked = [...items].sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0));
  const sites = spreadSites(ranked.length, clip);
  if (!sites.length) return [];

  const cells = voronoiCells(sites, clip);
  return ranked.flatMap((item, index) => {
    const site = sites[index];
    if (!site) return [];
    let cell = cells[index];
    if (!cell || ring(cell).length < 3) {
      const box = bboxOf(clip);
      const reach = Math.max(box.maxX - box.minX, box.maxY - box.minY) / Math.sqrt(sites.length + 2);
      cell = clipPolygon(circlePolygon(site[0], site[1], reach, 16), clip);
    }
    const poly = ring(cell);
    if (poly.length < 3) return [];
    const smoothed = chaikin(poly, 1);
    const [lon, lat] = centroid(smoothed);
    const path = ringToPath(smoothed);
    if (!path) return [];
    return [{ ...item, lon, lat, path, ring: smoothed }];
  });
}

function ring(pts: number[][]): number[][] {
  if (!pts.length) return [];
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts.slice(0, -1);
  return pts.slice();
}

function close(pts: number[][]): number[][] {
  if (!pts.length) return [];
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts;
  return [...pts, a];
}

function centroid(pts: number[][]): [number, number] {
  const r = ring(pts);
  if (!r.length) return [0, 0];
  let x = 0;
  let y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return [x / r.length, y / r.length];
}

function bboxOf(pts: number[][]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring(pts)) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function pointInPoly(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  const pts = ring(poly);
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function interiorGrid(poly: number[][], wanted: number): number[][] {
  const box = bboxOf(poly);
  const w = Math.max(box.maxX - box.minX, 1e-6);
  const h = Math.max(box.maxY - box.minY, 1e-6);
  const cols = Math.max(10, Math.ceil(Math.sqrt((wanted * 28 * w) / h)));
  const rows = Math.max(10, Math.ceil(Math.sqrt((wanted * 28 * h) / w)));
  const pts: number[][] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = box.minX + ((col + 0.5) / cols) * w;
      const y = box.minY + ((row + 0.5) / rows) * h;
      if (pointInPoly(x, y, poly)) pts.push([x, y]);
    }
  }
  return pts;
}

function spreadSites(count: number, poly: number[][]): number[][] {
  const interior = interiorGrid(poly, Math.max(count * 10, 48));
  const c = centroid(poly);
  if (!interior.length) {
    return Array.from({ length: count }, () => [c[0], c[1]]);
  }
  const chosen: number[][] = [];
  let nearest = 0;
  let nearestD = Infinity;
  for (let i = 0; i < interior.length; i++) {
    const d = (interior[i][0] - c[0]) ** 2 + (interior[i][1] - c[1]) ** 2;
    if (d < nearestD) {
      nearestD = d;
      nearest = i;
    }
  }
  const used = new Set([nearest]);
  chosen.push(interior[nearest]);
  while (chosen.length < count && used.size < interior.length) {
    let bestI = -1;
    let bestD = -1;
    for (let i = 0; i < interior.length; i++) {
      if (used.has(i)) continue;
      let minD = Infinity;
      for (const point of chosen) {
        const d = (interior[i][0] - point[0]) ** 2 + (interior[i][1] - point[1]) ** 2;
        if (d < minD) minD = d;
      }
      if (minD > bestD) {
        bestD = minD;
        bestI = i;
      }
    }
    if (bestI < 0) break;
    used.add(bestI);
    chosen.push(interior[bestI]);
  }
  return Array.from({ length: count }, (_, i) => chosen[i % chosen.length]);
}

function voronoiCells(sites: number[][], clip: number[][]): number[][][] {
  if (sites.length === 1) return [close(clip)];
  const box = bboxOf(clip);
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 0.2) * 0.3;
  const delaunay = Delaunay.from(sites.map((site) => [site[0], site[1]] as [number, number]));
  const voronoi = delaunay.voronoi([box.minX - pad, box.minY - pad, box.maxX + pad, box.maxY + pad]);
  return sites.map((_, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return [];
    return clipPolygon(cell, clip);
  });
}

function insideEdge(p: number[], a: number[], b: number[]): boolean {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12;
}

function intersection(p1: number[], p2: number[], a: number[], b: number[]): number[] {
  const den = (p1[0] - p2[0]) * (a[1] - b[1]) - (p1[1] - p2[1]) * (a[0] - b[0]);
  if (Math.abs(den) < 1e-12) return p2;
  const t = ((p1[0] - a[0]) * (a[1] - b[1]) - (p1[1] - a[1]) * (a[0] - b[0])) / den;
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}

function clipPolygon(subject: number[][], clip: number[][]): number[][] {
  const clipRing = ring(clip);
  let output = ring(subject);
  for (let i = 0; i < clipRing.length; i++) {
    const a = clipRing[i];
    const b = clipRing[(i + 1) % clipRing.length];
    const input = output;
    output = [];
    if (!input.length) return [];
    let prev = input[input.length - 1];
    for (const cur of input) {
      const curIn = insideEdge(cur, a, b);
      const prevIn = insideEdge(prev, a, b);
      if (curIn) {
        if (!prevIn) output.push(intersection(prev, cur, a, b));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersection(prev, cur, a, b));
      }
      prev = cur;
    }
  }
  if (output.length < 3) return [];
  return close(output);
}

function circlePolygon(cx: number, cy: number, r: number, n = 16): number[][] {
  const pts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  pts.push(pts[0]);
  return pts;
}

function convexHull(pts: number[][]): number[][] {
  const p = ring(pts)
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return close(p);
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: number[][] = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) {
      lower.pop();
    }
    lower.push(pt);
  }
  const upper: number[][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) {
      upper.pop();
    }
    upper.push(pt);
  }
  return close(lower.slice(0, -1).concat(upper.slice(0, -1)));
}

function chaikin(pts: number[][], iters = 1): number[][] {
  let r = ring(pts);
  for (let k = 0; k < iters; k++) {
    const next: number[][] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r = next;
  }
  return close(r);
}
