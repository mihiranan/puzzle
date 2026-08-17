import { NextResponse } from "next/server";
import { ensureFreshAtlas } from "@/lib/atlas-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const meta = await ensureFreshAtlas();
  return NextResponse.json(meta, {
    headers: { "Cache-Control": "no-store" },
  });
}
