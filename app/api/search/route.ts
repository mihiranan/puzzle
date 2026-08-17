import { NextResponse } from "next/server";
import { searchPlaces } from "@/lib/atlas";
import { loadAtlas } from "@/lib/load-atlas";
import { autocomplete } from "@/lib/catalog";
import type { SearchHit } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  const atlas = await loadAtlas();
  const local: SearchHit[] = searchPlaces(atlas, q, 6).map((place) => ({
    id: place.id,
    sourceId: place.sourceId,
    kind: place.kind,
    name: place.name,
    hint: place.description || place.kind,
    citedByCount: place.citedByCount,
    worksCount: place.worksCount,
    placeId: place.id,
  }));

  let remote: SearchHit[] = [];
  try {
    remote = await autocomplete(q);
  } catch (error) {
    console.error("Catalog autocomplete failed", error);
  }

  const seen = new Set(local.map((hit) => hit.id));
  const merged = [...local];
  for (const hit of remote) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    merged.push(hit);
  }

  return NextResponse.json({ results: merged.slice(0, 16) });
}
