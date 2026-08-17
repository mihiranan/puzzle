export const ERA_MIN = 1950;
export const ERA_MAX = 2026;
export const KEY_YEARS = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2018, 2024];
export const PRESENT_YEAR = KEY_YEARS[KEY_YEARS.length - 1];

export type EraSnapshots = {
  years: number[];
  names: Record<string, string>;
  present: Record<string, number>;
  counts: Record<number, Record<string, number>>;
  domains: Record<string, string>;
};

export type EraVisuals = {
  fieldActivity: Record<string, number>;
  domainActivity: Record<string, number>;
  fieldGrowth: Record<string, number>;
  domainGrowth: Record<string, number>;
  hottestField: string | null;
};

function countsForKey(snapshots: EraSnapshots, year: number): Record<string, number> {
  return snapshots.counts[year] ?? {};
}

export function countsAtYear(snapshots: EraSnapshots, year: number): Record<string, number> {
  const years = snapshots.years.map(Number);
  if (!years.length) return {};
  if (year <= years[0]) return countsForKey(snapshots, years[0]);
  if (year >= years[years.length - 1]) return countsForKey(snapshots, years[years.length - 1]);

  let laterIndex = years.findIndex((key) => key >= year);
  if (laterIndex <= 0) laterIndex = 1;
  const earlier = years[laterIndex - 1];
  const later = years[laterIndex];
  const t = (year - earlier) / Math.max(later - earlier, 1);
  const a = countsForKey(snapshots, earlier);
  const b = countsForKey(snapshots, later);
  const ids = new Set([...Object.keys(a), ...Object.keys(b)]);
  const mixed: Record<string, number> = {};
  for (const id of ids) {
    mixed[id] = (a[id] ?? 0) + ((b[id] ?? 0) - (a[id] ?? 0)) * t;
  }
  return mixed;
}

export function worksThroughYear(
  id: string,
  counts: Record<string, number> | null | undefined,
  fallback?: number,
): number | undefined {
  if (!counts) return fallback;
  if (counts[id] != null) return Math.round(counts[id]);
  return fallback;
}

export function citesThroughYear(
  allTimeCites: number | undefined | null,
  yearWorks: number | undefined,
  allTimeWorks: number | undefined,
): number | undefined {
  if (allTimeCites == null) return undefined;
  if (yearWorks == null || allTimeWorks == null || allTimeWorks <= 0) return allTimeCites;
  if (yearWorks >= allTimeWorks) return allTimeCites;
  return Math.round(allTimeCites * Math.max(0, yearWorks) / allTimeWorks);
}

export function scaleCountsToYear(
  untilYear: number | undefined,
  yearWorks: number | undefined,
  allWorks: number,
  allCites: number,
): { worksCount: number; citedByCount: number } {
  if (untilYear == null || yearWorks == null) {
    return { worksCount: allWorks, citedByCount: allCites };
  }
  const works = Math.max(0, Math.round(yearWorks));
  const cites = allWorks > 0 ? Math.round(allCites * Math.min(1, works / allWorks)) : 0;
  return { worksCount: works, citedByCount: cites };
}

export function isPlaceKind(kind: string): boolean {
  return kind === "domain" || kind === "field" || kind === "subfield" || kind === "topic";
}

export function fieldEraScale(
  fieldId: string | null | undefined,
  growth: Record<string, number>,
  eraReady = false,
): number {
  if (!fieldId || !eraReady) return 1;
  const grown = growth[fieldId];
  if (grown == null || grown < 0.015) return 0;
  return 0.1 + 0.9 * grown ** 0.55;
}

export function isAliveInEra(
  id: string,
  kind: string,
  year: number,
  counts: Record<string, number> | null,
): boolean {
  if (!counts) return true;
  if (kind === "domain" || kind === "work" || kind === "author" || kind === "institution" || kind === "source") {
    return true;
  }
  if (year >= ERA_MAX - 2) return true;
  const count = counts[id] ?? 0;
  if (kind === "field") return count > 0;
  if (kind === "subfield") return count >= 40;
  if (kind === "topic") return count >= 25;
  return true;
}

export function visualsFromCounts(
  counts: Record<string, number>,
  snapshots: EraSnapshots,
): EraVisuals {
  const entries = Object.entries(counts);
  const maxField = Math.max(...entries.map(([, count]) => count), 1);
  const fieldActivity: Record<string, number> = {};
  const fieldGrowth: Record<string, number> = {};
  const domainTotals: Record<string, number> = {};

  const presentDomain: Record<string, number> = {};
  for (const [fieldId, peak] of Object.entries(snapshots.present)) {
    const domainId = snapshots.domains[fieldId];
    if (domainId) presentDomain[domainId] = (presentDomain[domainId] ?? 0) + peak;
  }

  for (const [id, count] of entries) {
    fieldActivity[id] = 0.16 + 0.84 * (count / maxField);
    const present = snapshots.present[id] ?? 0;
    fieldGrowth[id] = present > 0 ? Math.max(0, Math.min(1, count / present)) : 0;
    const domainId = snapshots.domains[id];
    if (domainId) {
      domainTotals[domainId] = (domainTotals[domainId] ?? 0) + count;
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

  const hottest = entries.sort((a, b) => b[1] - a[1])[0];
  return {
    fieldActivity,
    domainActivity,
    fieldGrowth,
    domainGrowth,
    hottestField: hottest ? snapshots.names[hottest[0]] ?? hottest[0] : null,
  };
}
