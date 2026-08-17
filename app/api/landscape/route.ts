import { NextResponse } from "next/server";
import { indexPlaces } from "@/lib/atlas";
import { loadAtlas } from "@/lib/load-atlas";
import {
  fieldActivityForYear,
  landscapeWorks,
  catalogFilterForPlace,
  workToPin,
} from "@/lib/catalog";
import { PRESENT_YEAR } from "@/lib/era-metrics";
import type { EraLandscape, Place } from "@/lib/types";

let presentCounts: Map<string, number> | null = null;

async function presentDayCounts() {
  if (presentCounts) return presentCounts;
  const rows = await fieldActivityForYear(PRESENT_YEAR);
  presentCounts = new Map(rows.map((row) => [row.id, Math.max(row.count, 1)]));
  return presentCounts;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? "2024");
  const placeId = searchParams.get("place");
  if (!Number.isFinite(year) || year < 1800 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    const atlas = await loadAtlas();
    const byId = indexPlaces(atlas);
    const place: Place | null = placeId ? byId.get(placeId) ?? null : null;
    const [works, fieldRows, present] = await Promise.all([
      landscapeWorks(year, catalogFilterForPlace(place)),
      fieldActivityForYear(year),
      presentDayCounts(),
    ]);

    const maxField = Math.max(...fieldRows.map((row) => row.count), 1);
    const fieldActivity: Record<string, number> = {};
    const fieldGrowth: Record<string, number> = {};
    const domainTotals: Record<string, number> = {};
    const presentDomain: Record<string, number> = {};
    for (const [id, peak] of present) {
      const field = byId.get(id);
      if (field?.domainId) presentDomain[field.domainId] = (presentDomain[field.domainId] ?? 0) + peak;
    }
    for (const row of fieldRows) {
      fieldActivity[row.id] = 0.16 + 0.84 * (row.count / maxField);
      const peak = present.get(row.id) ?? 0;
      fieldGrowth[row.id] = peak > 0 ? Math.max(0, Math.min(1, row.count / peak)) : 0;
      const field = byId.get(row.id);
      if (field?.domainId) {
        domainTotals[field.domainId] = (domainTotals[field.domainId] ?? 0) + row.count;
      }
    }
    const maxDomain = Math.max(...Object.values(domainTotals), 1);
    const domainActivity: Record<string, number> = {};
    const domainGrowth: Record<string, number> = {};
    for (const [id, count] of Object.entries(domainTotals)) {
      domainActivity[id] = 0.16 + 0.84 * (count / maxDomain);
      const peak = presentDomain[id] ?? 0;
      domainGrowth[id] = peak > 0 ? Math.max(0, Math.min(1, count / peak)) : 0;
    }

    const pins = works
      .map((work) => workToPin(work, atlas, byId))
      .filter((pin): pin is NonNullable<typeof pin> => Boolean(pin))
      .map((pin) => ({ ...pin, era: true }));

    const hottest = [...fieldRows].sort((a, b) => b.count - a.count)[0];
    const payload: EraLandscape = {
      year,
      pins,
      fieldActivity,
      domainActivity,
      fieldGrowth,
      domainGrowth,
      headline: pins[0]?.name ?? null,
      hottestField: hottest?.name ?? null,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load landscape" },
      { status: 500 },
    );
  }
}
