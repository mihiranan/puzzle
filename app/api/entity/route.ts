import { NextResponse } from "next/server";
import { loadAtlas } from "@/lib/load-atlas";
import { inspectEntity } from "@/lib/catalog";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const untilRaw = Number(searchParams.get("until"));
  const untilYear = Number.isFinite(untilRaw) ? Math.round(untilRaw) : undefined;
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  try {
    const atlas = await loadAtlas();
    const entity = await inspectEntity(id, atlas, untilYear);
    return NextResponse.json(entity);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load entity" },
      { status: 500 },
    );
  }
}
