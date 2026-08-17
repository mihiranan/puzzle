import { NextResponse } from "next/server";
import { indexPlaces } from "@/lib/atlas";
import { loadAtlas } from "@/lib/load-atlas";
import { influentialWorksForPlace, workToPin } from "@/lib/openalex";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const placeId = searchParams.get("place");
  const untilRaw = Number(searchParams.get("until"));
  const untilYear = Number.isFinite(untilRaw) ? Math.round(untilRaw) : undefined;
  if (!placeId) {
    return NextResponse.json({ error: "Missing place" }, { status: 400 });
  }
  try {
    const atlas = await loadAtlas();
    const byId = indexPlaces(atlas);
    const place = byId.get(placeId) ?? null;
    if (!place) {
      return NextResponse.json({ placeId, pins: [] });
    }
    const works = await influentialWorksForPlace(place, atlas, untilYear);
    const pins = works
      .map((work) => workToPin(work, atlas, byId))
      .filter((pin): pin is NonNullable<typeof pin> => Boolean(pin));
    return NextResponse.json({ placeId, pins });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load papers" },
      { status: 500 },
    );
  }
}
