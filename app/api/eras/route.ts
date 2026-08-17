import { NextResponse } from "next/server";
import { indexPlaces } from "@/lib/atlas";
import { KEY_YEARS, PRESENT_YEAR, type EraSnapshots } from "@/lib/era-metrics";
import { loadAtlas } from "@/lib/load-atlas";
import { corpusThroughYear } from "@/lib/catalog";

let cached: EraSnapshots | null = null;
const CACHE_KIND = "corpus-through-year-v2-topics";
let cacheKind = "";
let cachedAtlasAt = "";

export async function GET() {
  const atlas = await loadAtlas();
  if (cached && cacheKind === CACHE_KIND && cachedAtlasAt === atlas.generatedAt) {
    return NextResponse.json(cached);
  }
  const byId = indexPlaces(atlas);
  const names: Record<string, string> = {};
  const domains: Record<string, string> = {};
  const counts: Record<number, Record<string, number>> = {};

  for (const [index, year] of KEY_YEARS.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 80));
    const [fields, subfields, topics] = await Promise.all([
      corpusThroughYear(year, "primary_topic.field.id"),
      corpusThroughYear(year, "primary_topic.subfield.id"),
      corpusThroughYear(year, "primary_topic.id"),
    ]);
    counts[year] = {};
    for (const row of [...fields, ...subfields, ...topics]) {
      counts[year][row.id] = row.count;
      names[row.id] = row.name;
      const place = byId.get(row.id);
      if (place?.domainId) domains[row.id] = place.domainId;
    }
  }

  const present = counts[PRESENT_YEAR] ?? {};
  cached = {
    years: KEY_YEARS,
    names,
    present,
    counts,
    domains,
  };
  cacheKind = CACHE_KIND;
  cachedAtlasAt = atlas.generatedAt;
  return NextResponse.json(cached);
}
