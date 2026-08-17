import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Atlas } from "./types";

export const ATLAS_PATH = join(process.cwd(), "public/data/atlas.json");
export const ATLAS_META_PATH = join(process.cwd(), "public/data/atlas.meta.json");

let cached: Atlas | null = null;
let cachedMtime = 0;

export async function loadAtlas(): Promise<Atlas> {
  const { mtimeMs } = await stat(ATLAS_PATH);
  if (cached && cachedMtime === mtimeMs) return cached;
  const raw = await readFile(ATLAS_PATH, "utf8");
  cached = JSON.parse(raw) as Atlas;
  cachedMtime = mtimeMs;
  return cached;
}

export function invalidateAtlasCache() {
  cached = null;
  cachedMtime = 0;
}
