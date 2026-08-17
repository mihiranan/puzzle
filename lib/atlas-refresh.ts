import { spawn } from "node:child_process";
import { access, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { ATLAS_META_PATH, ATLAS_PATH, invalidateAtlasCache } from "./load-atlas";

export const ATLAS_TTL_MS = 12 * 60 * 60 * 1000;
const LOCK_PATH = `${ATLAS_PATH}.refresh.lock`;
const LOCK_STALE_MS = 12 * 60 * 1000;

export type AtlasRefreshMeta = {
  generatedAt: string | null;
  source: string | null;
  stats: {
    domains: number;
    fields: number;
    subfields: number;
    topics: number;
  } | null;
  stale: boolean;
  refreshing: boolean;
  ageMs: number | null;
};

type Sidecar = {
  generatedAt?: string;
  source?: string;
  stats?: AtlasRefreshMeta["stats"];
};

let building: Promise<void> | null = null;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readAtlasRefreshMeta(): Promise<AtlasRefreshMeta> {
  let generatedAt: string | null = null;
  let source: string | null = null;
  let stats: AtlasRefreshMeta["stats"] = null;
  let ageMs: number | null = null;

  if (await pathExists(ATLAS_META_PATH)) {
    try {
      const sidecar = JSON.parse(await readFile(ATLAS_META_PATH, "utf8")) as Sidecar;
      generatedAt = sidecar.generatedAt ?? null;
      source = sidecar.source ?? null;
      stats = sidecar.stats ?? null;
    } catch {
      generatedAt = null;
    }
  }

  if (await pathExists(ATLAS_PATH)) {
    const file = await stat(ATLAS_PATH);
    ageMs = Math.max(0, Date.now() - file.mtimeMs);
    if (!generatedAt) generatedAt = file.mtime.toISOString();
  }

  return {
    generatedAt,
    source,
    stats,
    ageMs,
    stale: ageMs == null || ageMs >= ATLAS_TTL_MS,
    refreshing: building !== null || (await lockIsLive()),
  };
}

async function lockIsLive(): Promise<boolean> {
  try {
    const file = await stat(LOCK_PATH);
    return Date.now() - file.mtimeMs < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

async function takeLock(): Promise<boolean> {
  if (await lockIsLive()) return false;
  try {
    await unlink(LOCK_PATH);
  } catch {
    /* no leftover lock */
  }
  try {
    await writeFile(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: "wx" },
    );
    return true;
  } catch {
    return false;
  }
}

async function dropLock() {
  try {
    await unlink(LOCK_PATH);
  } catch {
    /* already gone */
  }
}

function runAtlasBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/build-atlas.mjs"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.stdout.on("data", (chunk) => {
      const line = String(chunk).trimEnd();
      if (line) console.log(`[atlas] ${line}`);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Atlas rebuild exited ${code}`));
    });
  });
}

async function rebuildAtlas(): Promise<void> {
  const locked = await takeLock();
  if (!locked) return;
  try {
    await runAtlasBuild();
    invalidateAtlasCache();
  } finally {
    await dropLock();
  }
}

function startAtlasRefresh(): boolean {
  if (building) return false;
  building = rebuildAtlas()
    .catch((error) => {
      console.error("Atlas refresh failed", error);
    })
    .finally(() => {
      building = null;
    });
  return true;
}

export async function ensureFreshAtlas(): Promise<AtlasRefreshMeta> {
  const meta = await readAtlasRefreshMeta();
  if (meta.stale && !meta.refreshing) startAtlasRefresh();
  return readAtlasRefreshMeta();
}
