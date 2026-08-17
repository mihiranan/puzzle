#!/usr/bin/env node
/**
 * Build a geographic atlas of knowledge:
 * 4 domain continents → field countries → subfield provinces → topic cities.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Delaunay } from "d3-delaunay";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/data/atlas.json");
const META = resolve(ROOT, "public/data/atlas.meta.json");
const CATALOG_ORIGIN = "https://api.openalex.org";
const MAILTO = process.env.CATALOG_MAILTO ?? "mihiranan@users.noreply.github.com";

const CONTINENTS = {
  "Physical Sciences": { lon: -102, lat: 18, r: 44 },
  "Life Sciences": { lon: -8, lat: -28, r: 31 },
  "Health Sciences": { lon: 108, lat: 12, r: 33 },
  "Social Sciences": { lon: 18, lat: 52, r: 29 },
};

const PALETTE = {
  "Physical Sciences": {
    land: "#163847",
    fill: "#1f5164",
    coast: "#8fd4ea",
    label: "#e7f6fc",
  },
  "Life Sciences": {
    land: "#15382c",
    fill: "#1d5240",
    coast: "#8fdeae",
    label: "#e3f7ea",
  },
  "Health Sciences": {
    land: "#3d1d28",
    fill: "#5a2a39",
    coast: "#f0a8b4",
    label: "#fde8ec",
  },
  "Social Sciences": {
    land: "#3c2c14",
    fill: "#5a4320",
    coast: "#f0c56e",
    label: "#f8ead0",
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hash32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function sourceRef(url) {
  return String(url ?? "").replace(/^https?:\/\/openalex\.org\//i, "");
}

function shortId(url) {
  const raw = String(url).split("/").pop() ?? "";
  if (raw.startsWith("T")) return `topic:${raw}`;
  if (raw.startsWith("W")) return `work:${raw}`;
  if (raw.startsWith("A")) return `author:${raw}`;
  if (raw.startsWith("I") && /I\d+/.test(raw)) return `institution:${raw}`;
  if (raw.startsWith("S") && /S\d+/.test(raw)) return `source:${raw}`;
  if (url.includes("/domains/")) return `domain:${raw}`;
  if (url.includes("/fields/")) return `field:${raw}`;
  if (url.includes("/subfields/")) return `subfield:${raw}`;
  return raw;
}

async function catalogGet(path) {
  const url = path.startsWith("http")
    ? path
    : `${CATALOG_ORIGIN}${path}${path.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(MAILTO)}`;
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: {
        "User-Agent": `Puzzle/0.1 (https://github.com/mihiranan/puzzle; mailto:${MAILTO})`,
        Accept: "application/json",
      },
    });
    if (res.status === 429 || res.status >= 500) {
      last = new Error(`Catalog ${res.status} for ${path}`);
      await sleep(400 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`Catalog ${res.status} for ${path}`);
    return res.json();
  }
  throw last ?? new Error(`Catalog failed for ${path}`);
}

async function fetchAll(path, perPage = 200) {
  const first = await catalogGet(`${path}${path.includes("?") ? "&" : "?"}per_page=${perPage}&page=1`);
  const total = first.meta?.count ?? first.results.length;
  const pages = Math.ceil(total / perPage);
  const results = [...first.results];
  for (let page = 2; page <= pages; page++) {
    await sleep(120);
    const data = await catalogGet(
      `${path}${path.includes("?") ? "&" : "?"}per_page=${perPage}&page=${page}`,
    );
    results.push(...data.results);
    process.stdout.write(`  ${path} ${results.length}/${total}\r`);
  }
  process.stdout.write("\n");
  return results;
}

function circlePolygon(cx, cy, r, n = 64) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  pts.push(pts[0]);
  return pts;
}

function insideEdge(p, a, b) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-12;
}

function intersection(p1, p2, a, b) {
  const x1 = p1[0];
  const y1 = p1[1];
  const x2 = p2[0];
  const y2 = p2[1];
  const x3 = a[0];
  const y3 = a[1];
  const x4 = b[0];
  const y4 = b[1];
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) < 1e-12) return p2;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

function clipPolygon(subject, clip) {
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

function ring(pts) {
  if (!pts?.length) return [];
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts.slice(0, -1);
  return pts.slice();
}

function close(pts) {
  if (!pts.length) return [];
  const a = pts[0];
  const b = pts[pts.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return pts;
  return [...pts, a];
}

function chaikin(pts, iters = 2) {
  let r = ring(pts);
  for (let k = 0; k < iters; k++) {
    const next = [];
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

function centroid(pts) {
  const r = ring(pts);
  let x = 0;
  let y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return [x / r.length, y / r.length];
}

function insetToward(pts, t = 0.08) {
  const c = centroid(pts);
  return close(ring(pts).map(([x, y]) => [x + (c[0] - x) * t, y + (c[1] - y) * t]));
}

function organicize(pts, seed, amount = 0.045) {
  const r = ring(pts);
  const c = centroid(r);
  return close(
    r.map((p, i) => {
      const n = ((hash32(`${seed}:${i}`) % 1000) / 1000 - 0.5) * 2 * amount;
      return [p[0] + (p[0] - c[0]) * n, p[1] + (p[1] - c[1]) * n];
    }),
  );
}

function minRadius(pts) {
  const c = centroid(pts);
  let min = Infinity;
  for (const p of ring(pts)) {
    const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
    if (d < min) min = d;
  }
  return min === Infinity ? 0.1 : min;
}

function shade(hex, delta) {
  const n = parseInt(hex.slice(1), 16);
  const adj = (ch) => Math.max(0, Math.min(255, ch + delta));
  const r = adj((n >> 16) & 255);
  const g = adj((n >> 8) & 255);
  const b = adj(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function sitesFor(items) {
  const sorted = [...items].sort((a, b) => (b.worksCount ?? 0) - (a.worksCount ?? 0));
  const n = sorted.length;
  const golden = Math.PI * (3 - Math.sqrt(5));
  return sorted.map((item, i) => {
    const radius = n === 1 ? 0 : 0.78 * Math.sqrt(i / (n - 0.35));
    const angle = i * golden + 0.55;
    return {
      item,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

function convexHull(pts) {
  const p = ring(pts)
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return close(p);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) {
      lower.pop();
    }
    lower.push(pt);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) {
      upper.pop();
    }
    upper.push(pt);
  }
  return close(lower.slice(0, -1).concat(upper.slice(0, -1)));
}

function bboxOf(pts) {
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

function pointInPoly(x, y, poly) {
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

function interiorGrid(poly, wanted) {
  const box = bboxOf(poly);
  const w = Math.max(box.maxX - box.minX, 1e-6);
  const h = Math.max(box.maxY - box.minY, 1e-6);
  const cols = Math.max(10, Math.ceil(Math.sqrt((wanted * 28 * w) / h)));
  const rows = Math.max(10, Math.ceil(Math.sqrt((wanted * 28 * h) / w)));
  const pts = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = box.minX + ((col + 0.5) / cols) * w;
      const y = box.minY + ((row + 0.5) / rows) * h;
      if (pointInPoly(x, y, poly)) pts.push([x, y]);
    }
  }
  return pts;
}

function spreadSites(items, poly) {
  const sorted = [...items].sort((a, b) => (b.worksCount ?? 0) - (a.worksCount ?? 0));
  const interior = interiorGrid(poly, Math.max(sorted.length * 10, 48));
  const c = centroid(poly);
  if (!interior.length) {
    return sorted.map((item) => ({ item, x: c[0], y: c[1] }));
  }
  const chosen = [];
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
  while (chosen.length < sorted.length && used.size < interior.length) {
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
  return sorted.map((item, i) => ({
    item,
    x: chosen[i % chosen.length][0],
    y: chosen[i % chosen.length][1],
  }));
}

function fillCells(items, parentPoly) {
  if (!items.length) return [];
  const hull = convexHull(parentPoly);
  const clip = ring(hull).length >= 3 ? hull : parentPoly;
  const placed = spreadSites(items, clip);
  const cells = voronoiCells(placed, clip);
  return placed.map((site, i) => {
    let cell = cells[i];
    if (!cell || ring(cell).length < 3) {
      const box = bboxOf(clip);
      const reach = Math.max(box.maxX - box.minX, box.maxY - box.minY) / Math.sqrt(placed.length + 2);
      cell = clipPolygon(circlePolygon(site.x, site.y, reach, 16), clip);
    }
    if (ring(cell).length >= 3) cell = insetToward(cell, 0.01);
    if (ring(cell).length >= 3) cell = chaikin(cell, 1);
    return { site, cell };
  });
}

function voronoiCells(sites, clip) {
  if (sites.length === 1) {
    return [clip.slice()];
  }
  const box = bboxOf(clip);
  const pad = Math.max(box.maxX - box.minX, box.maxY - box.minY, 0.2) * 0.3;
  const delaunay = Delaunay.from(sites.map((s) => [s.x, s.y]));
  const voronoi = delaunay.voronoi([
    box.minX - pad,
    box.minY - pad,
    box.maxX + pad,
    box.maxY + pad,
  ]);
  return sites.map((_, i) => {
    const cell = voronoi.cellPolygon(i);
    if (!cell) return [];
    return clipPolygon(cell, clip);
  });
}

function localToLonLat(continent, x, y) {
  const lat = continent.lat + y * continent.r;
  const lon = continent.lon + (x * continent.r) / Math.cos((continent.lat * Math.PI) / 180);
  return [lon, lat];
}

function projectRing(continent, pts) {
  return close(ring(pts).map(([x, y]) => localToLonLat(continent, x, y)));
}

function feature(place, geometry) {
  return {
    type: "Feature",
    id: place.id,
    properties: {
      id: place.id,
      name: place.name,
      kind: place.kind,
      parentId: place.parentId,
      domainId: place.domainId,
      fieldId: place.fieldId ?? null,
      subfieldId: place.subfieldId ?? null,
      worksCount: place.worksCount,
      citedByCount: place.citedByCount,
      fill: place.fill,
      coast: place.coast,
      label: place.label,
    },
    geometry,
  };
}

async function main() {
  console.log("Fetching taxonomy…");
  const [domains, fields, subfields, topics] = await Promise.all([
    fetchAll("/domains", 25),
    fetchAll("/fields", 50),
    fetchAll("/subfields", 200),
    fetchAll("/topics", 200),
  ]);

  console.log(
    `Loaded ${domains.length} domains, ${fields.length} fields, ${subfields.length} subfields, ${topics.length} topics`,
  );

  const topicsBySubfield = new Map();
  for (const topic of topics) {
    const sf = shortId(topic.subfield?.id ?? "");
    if (!topicsBySubfield.has(sf)) topicsBySubfield.set(sf, []);
    topicsBySubfield.get(sf).push(topic);
  }

  const places = [];
  const domainFeatures = [];
  const fieldFeatures = [];
  const subfieldFeatures = [];
  const topicFeatures = [];

  for (const domain of domains) {
    const name = domain.display_name;
    const continent = CONTINENTS[name];
    const palette = PALETTE[name];
    if (!continent || !palette) {
      console.warn("Skipping unmapped domain", name);
      continue;
    }

    const domainPlace = {
      id: shortId(domain.id),
      sourceId: sourceRef(domain.id),
      name,
      kind: "domain",
      description: domain.description ?? "",
      parentId: null,
      domainId: shortId(domain.id),
      worksCount: domain.works_count ?? 0,
      citedByCount: domain.cited_by_count ?? 0,
      lon: continent.lon,
      lat: continent.lat,
      radius: continent.r * 0.55,
      fill: palette.land,
      coast: palette.coast,
      label: palette.label,
      zoom: 0,
      labelMinZoom: 0.6,
    };

    const domainFields = fields.filter((f) => shortId(f.domain?.id) === domainPlace.id);
    const fieldSites = sitesFor(
      domainFields.map((f) => ({
        raw: f,
        worksCount: f.works_count ?? 0,
      })),
    );
    const land = circlePolygon(0, 0, 0.98, 72);
    const fieldCells = voronoiCells(fieldSites, land);

    const fieldPolys = [];

    fieldSites.forEach((site, i) => {
      const raw = site.item.raw;
      let poly = fieldCells[i];
      if (!poly || ring(poly).length < 3) return;
      poly = insetToward(poly, 0.012);
      poly = chaikin(poly, 1);
      const c = centroid(poly);
      const [lon, lat] = localToLonLat(continent, c[0], c[1]);
      const tint = ((hash32(raw.display_name) % 24) - 10) * 2;
      const fieldPlace = {
        id: shortId(raw.id),
        sourceId: sourceRef(raw.id),
        name: raw.display_name,
        kind: "field",
        description: raw.description ?? "",
        parentId: domainPlace.id,
        domainId: domainPlace.id,
        fieldId: shortId(raw.id),
        worksCount: raw.works_count ?? 0,
        citedByCount: raw.cited_by_count ?? 0,
        lon,
        lat,
        radius: minRadius(poly) * continent.r,
        fill: shade(palette.fill, tint),
        coast: palette.coast,
        label: palette.label,
        zoom: 1.4,
        labelMinZoom: 2.1,
        _local: poly,
      };
      places.push(fieldPlace);
      const projected = projectRing(continent, poly);
      fieldPolys.push(projected);
      fieldFeatures.push(
        feature(fieldPlace, {
          type: "Polygon",
          coordinates: [projected],
        }),
      );

      const childSubfields = subfields.filter((s) => shortId(s.field?.id) === fieldPlace.id);
      const filledSubs = fillCells(
        childSubfields.map((s) => ({
          raw: s,
          worksCount: s.works_count ?? 0,
        })),
        poly,
      );

      filledSubs.forEach(({ site: subSite, cell: spol }) => {
        const sraw = subSite.item.raw;
        if (!spol || ring(spol).length < 3) return;
        const sc = centroid(spol);
        const [slon, slat] = localToLonLat(continent, sc[0], sc[1]);
        const stint = ((hash32(sraw.display_name) % 20) - 8) * 2;
        const subPlace = {
          id: shortId(sraw.id),
          sourceId: sourceRef(sraw.id),
          name: sraw.display_name,
          kind: "subfield",
          description: sraw.description ?? "",
          parentId: fieldPlace.id,
          domainId: domainPlace.id,
          fieldId: fieldPlace.id,
          subfieldId: shortId(sraw.id),
          worksCount: sraw.works_count ?? 0,
          citedByCount: sraw.cited_by_count ?? 0,
          lon: slon,
          lat: slat,
          radius: minRadius(spol) * continent.r,
          fill: shade(palette.fill, stint + 8),
          coast: palette.coast,
          label: palette.label,
          zoom: 3.2,
          labelMinZoom: 3.8,
        };
        places.push(subPlace);
        subfieldFeatures.push(
          feature(subPlace, {
            type: "Polygon",
            coordinates: [projectRing(continent, spol)],
          }),
        );

        const kids = (topicsBySubfield.get(subPlace.id) ?? []).sort(
          (a, b) => (b.works_count ?? 0) - (a.works_count ?? 0),
        );
        const filledTopics = fillCells(
          kids.map((topic) => ({
            raw: topic,
            worksCount: topic.works_count ?? 0,
          })),
          spol,
        );
        filledTopics.forEach(({ site, cell }) => {
          const topic = site.item.raw;
          if (!cell || ring(cell).length < 3) return;
          const tc = centroid(cell);
          const [tlon, tlat] = localToLonLat(continent, tc[0], tc[1]);
          const topicPlace = {
            id: shortId(topic.id),
            sourceId: sourceRef(topic.id),
            name: topic.display_name,
            kind: "topic",
            description: topic.description ?? "",
            parentId: subPlace.id,
            domainId: domainPlace.id,
            fieldId: fieldPlace.id,
            subfieldId: subPlace.id,
            worksCount: topic.works_count ?? 0,
            citedByCount: topic.cited_by_count ?? 0,
            lon: tlon,
            lat: tlat,
            radius: minRadius(cell) * continent.r,
            fill: palette.coast,
            coast: palette.coast,
            label: palette.label,
            zoom: 4.6,
            labelMinZoom: 5.1,
          };
          places.push(topicPlace);
          topicFeatures.push(
            feature(topicPlace, {
              type: "Polygon",
              coordinates: [projectRing(continent, cell)],
            }),
          );
        });
      });
    });

    const domainPoly =
      fieldPolys.length > 0
        ? projectRing(continent, land)
        : projectRing(continent, circlePolygon(0, 0, 0.98, 64));
    // Domain land is the continental shelf under the countries.
    const shelf = projectRing(
      continent,
      organicize(circlePolygon(0, 0, 1.04, 80), domain.id, 0.035),
    );
    const smoothedShelf = chaikin(shelf, 2);
    domainFeatures.push(
      feature(domainPlace, {
        type: "Polygon",
        coordinates: [smoothedShelf],
      }),
    );
    places.unshift(domainPlace);
  }

  const atlas = {
    generatedAt: new Date().toISOString(),
    source: "Puzzle",
    stats: {
      domains: places.filter((p) => p.kind === "domain").length,
      fields: places.filter((p) => p.kind === "field").length,
      subfields: places.filter((p) => p.kind === "subfield").length,
      topics: places.filter((p) => p.kind === "topic").length,
    },
    places: places.map(({ _local, ...p }) => p),
    geojson: {
      domains: { type: "FeatureCollection", features: domainFeatures },
      fields: { type: "FeatureCollection", features: fieldFeatures },
      subfields: { type: "FeatureCollection", features: subfieldFeatures },
      topics: { type: "FeatureCollection", features: topicFeatures },
    },
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(atlas));
  await writeFile(
    META,
    JSON.stringify(
      {
        generatedAt: atlas.generatedAt,
        source: atlas.source,
        stats: atlas.stats,
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${OUT}`);
  console.log(atlas.stats);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
