import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { ensureFreshAtlas } from "@/lib/atlas-refresh";
import { ATLAS_PATH } from "@/lib/load-atlas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureFreshAtlas();
  const raw = await readFile(ATLAS_PATH);
  return new NextResponse(raw, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
