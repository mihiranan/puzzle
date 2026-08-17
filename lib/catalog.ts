import { ancestors, indexPlaces, jitter, locatePlace } from "./atlas";
import { scaleCountsToYear } from "./era-metrics";
import { cleanText } from "./format";
import type {
  Atlas,
  EntityKind,
  InspectedEntity,
  NeighborhoodLink,
  Place,
  SearchHit,
} from "./types";

const CATALOG_ORIGIN = "https://api.openalex.org";

function catalogMailto(): string {
  return process.env.CATALOG_MAILTO ?? "mihiranan@users.noreply.github.com";
}

function shortSourceId(url: string | null | undefined): string {
  if (!url) return "";
  const raw = String(url).split("/").pop() ?? "";
  if (raw.startsWith("T")) return `topic:${raw}`;
  if (raw.startsWith("W")) return `work:${raw}`;
  if (raw.startsWith("A")) return `author:${raw}`;
  if (raw.startsWith("I") && /^I\d+/.test(raw)) return `institution:${raw}`;
  if (raw.startsWith("S") && /^S\d+/.test(raw)) return `source:${raw}`;
  if (url.includes("/domains/")) return `domain:${raw}`;
  if (url.includes("/fields/")) return `field:${raw}`;
  if (url.includes("/subfields/")) return `subfield:${raw}`;
  return raw;
}

function parseEntityId(id: string): { kind: EntityKind; sourceId: string } | null {
  const [kind, rest] = id.split(":");
  if (!kind || !rest) return null;
  const path =
    kind === "work"
      ? `works/${rest}`
      : kind === "author"
        ? `authors/${rest}`
        : kind === "institution"
          ? `institutions/${rest}`
          : kind === "source"
            ? `sources/${rest}`
            : kind === "topic"
              ? `topics/${rest}`
              : kind === "field"
                ? `fields/${rest}`
                : kind === "subfield"
                  ? `subfields/${rest}`
                  : kind === "domain"
                    ? `domains/${rest}`
                    : null;
  if (!path) return null;
  return { kind: kind as EntityKind, sourceId: `${CATALOG_ORIGIN}/${path}` };
}

type CatalogRecord = Record<string, unknown>;

type CatalogPage = {
  results?: CatalogRecord[];
  meta?: { count?: number };
};

async function catalogGet<T>(path: string): Promise<T> {
  const mailto = catalogMailto();
  const url = path.startsWith("http")
    ? `${path}${path.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(mailto)}`
    : `${CATALOG_ORIGIN}${path}${path.includes("?") ? "&" : "?"}mailto=${encodeURIComponent(mailto)}`;
  const headers: Record<string, string> = {
    "User-Agent": `Puzzle/0.1 (https://github.com/mihiranan/puzzle; mailto:${mailto})`,
    Accept: "application/json",
  };
  if (process.env.CATALOG_API_KEY) {
    headers.Authorization = `Bearer ${process.env.CATALOG_API_KEY}`;
  }
  const res = await fetch(url, { headers, next: { revalidate: 3600 } });
  if (!res.ok) {
    throw new Error(`Catalog ${res.status} for ${path}`);
  }
  return res.json() as Promise<T>;
}

function invertAbstract(
  inverted: Record<string, number[]> | null | undefined,
): string {
  if (!inverted) return "";
  const words: string[] = [];
  for (const [word, indexes] of Object.entries(inverted)) {
    for (const index of indexes) words[index] = word;
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

type AutocompleteItem = {
  id: string;
  display_name: string;
  hint?: string | null;
  cited_by_count?: number;
  works_count?: number;
  entity_type: string;
};

export async function autocomplete(query: string): Promise<SearchHit[]> {
  const data = await catalogGet<{ results: AutocompleteItem[] }>(
    `/autocomplete?q=${encodeURIComponent(query)}`,
  );
  return (data.results ?? [])
    .filter((item) => item.entity_type !== "funder" && item.entity_type !== "publisher")
    .map((item) => ({
      id: shortSourceId(item.id),
      sourceId: item.id,
      kind: (item.entity_type === "keyword" ? "keyword" : item.entity_type) as EntityKind,
      name: cleanText(item.display_name),
      hint: item.hint,
      citedByCount: item.cited_by_count,
      worksCount: item.works_count,
    }));
}

function asRecord(value: unknown): CatalogRecord | null {
  return value && typeof value === "object" ? (value as CatalogRecord) : null;
}

function asList(value: unknown): CatalogRecord[] {
  return Array.isArray(value) ? value.filter((item): item is CatalogRecord => Boolean(asRecord(item))) : [];
}

function displayName(value: unknown): string {
  const rec = asRecord(value);
  if (rec && typeof rec.display_name === "string") return rec.display_name;
  return "";
}

function topicIdsFrom(entity: CatalogRecord): {
  topicId?: string;
  subfieldId?: string;
  fieldId?: string;
  domainId?: string;
} {
  const primary = asRecord(entity.primary_topic) ?? asList(entity.topics)[0];
  if (!primary) return {};
  return {
    topicId: shortSourceId(String(primary.id ?? "")),
    subfieldId: shortSourceId(String(asRecord(primary.subfield)?.id ?? "")),
    fieldId: shortSourceId(String(asRecord(primary.field)?.id ?? "")),
    domainId: shortSourceId(String(asRecord(primary.domain)?.id ?? "")),
  };
}

function linkFrom(
  entity: CatalogRecord,
  kind: EntityKind,
  extra?: Partial<NeighborhoodLink>,
): NeighborhoodLink {
  return {
    id: shortSourceId(String(entity.id ?? "")),
    kind,
    name: cleanText(String(entity.display_name ?? "Untitled")),
    hint: extra?.hint ? cleanText(extra.hint) : extra?.hint,
    citedByCount: Number(entity.cited_by_count ?? extra?.citedByCount ?? 0) || undefined,
    year: extra?.year ?? (typeof entity.publication_year === "number" ? entity.publication_year : null),
  };
}

async function hydrateWorks(ids: string[], limit = 6): Promise<CatalogRecord[]> {
  const clean = ids
    .map((id) => id.split("/").pop())
    .filter(Boolean)
    .slice(0, limit);
  if (!clean.length) return [];
  const data = await catalogGet<{ results: CatalogRecord[] }>(
    `/works?filter=openalex:${clean.join("|")}&per_page=${clean.length}`,
  );
  return data.results ?? [];
}

export async function inspectEntity(
  id: string,
  atlas: Atlas,
  untilYear?: number,
): Promise<InspectedEntity> {
  const byId = indexPlaces(atlas);
  const local = byId.get(id);
  if (local) {
    const path = ancestors(local, byId);
    let works: NeighborhoodLink[] = [];
    let yearWorks: number | undefined;
    try {
      const filter = [catalogFilterForPlace(local), untilYear ? yearRangeFilter(untilYear) : null]
        .filter(Boolean)
        .join(",");
      const data = await catalogGet<CatalogPage>(
        `/works?filter=${encodeURIComponent(filter)}&sort=cited_by_count:desc&per_page=8&select=id,display_name,publication_year,cited_by_count,authorships`,
      );
      works = (data.results ?? []).map((work) => linkFrom(work, "work"));
      yearWorks = Number(data.meta?.count);
      if (!Number.isFinite(yearWorks)) yearWorks = undefined;
    } catch {
      works = [];
    }
    const sized = scaleCountsToYear(untilYear, yearWorks, local.worksCount, local.citedByCount);
    return {
      id: local.id,
      sourceId: local.sourceId,
      kind: local.kind,
      name: local.name,
      description: local.description ?? "",
      citedByCount: sized.citedByCount,
      worksCount: sized.worksCount,
      path,
      place: local,
      lon: local.lon,
      lat: local.lat,
      topics: atlas.places
        .filter((place) => place.parentId === local.id)
        .sort((a, b) => b.worksCount - a.worksCount)
        .slice(0, 8)
        .map((place) => ({
          id: place.id,
          kind: place.kind,
          name: place.name,
          citedByCount: place.citedByCount,
          worksCount: place.worksCount,
        })),
      people: [],
      institutions: [],
      works,
      sources: [],
      alsoIn: siblings(local, byId).slice(0, 8).map((place) => ({
        id: place.id,
        kind: place.kind,
        name: place.name,
        citedByCount: place.citedByCount,
        worksCount: place.worksCount,
      })),
    };
  }

  const parsed = parseEntityId(id);
  if (!parsed) throw new Error(`Unknown entity ${id}`);

  const entity = await catalogGet<CatalogRecord>(parsed.sourceId);
  const ids = topicIdsFrom(entity);
  const preferField = parsed.kind === "institution" || parsed.kind === "author";
  const place =
    (preferField
      ? locatePlace(byId, ids.fieldId, ids.subfieldId, ids.topicId, ids.domainId)
      : locatePlace(byId, ids.topicId, ids.subfieldId, ids.fieldId, ids.domainId)) ??
    (parsed.kind === "topic" ? byId.get(id) ?? null : null);
  const origin = place ?? atlas.places.find((p) => p.kind === "domain") ?? atlas.places[0];
  const jittered = jitter(origin.lon, origin.lat, id, place?.kind === "topic" ? 0.28 : 0.55);
  const path = place ? ancestors(place, byId) : [];
  const whyHere = placementCopy(parsed.kind, place);

  const topics = asList(entity.topics)
    .slice(0, 8)
    .map((topic) => linkFrom(topic, "topic"));

  if (parsed.kind === "work") {
    const authorships = asList(entity.authorships);
    const people: NeighborhoodLink[] = [];
    const seenPeople = new Set<string>();
    for (const row of authorships) {
      const author = asRecord(row.author);
      if (!author) continue;
      const link = linkFrom(author, "author", {
        hint: displayName(asList(row.institutions)[0]) || null,
      });
      if (!link.id || seenPeople.has(link.id)) continue;
      seenPeople.add(link.id);
      people.push(link);
    }
    const institutions = authorships
      .flatMap((row) => asList(row.institutions))
      .filter((inst, index, all) => all.findIndex((other) => other.id === inst.id) === index)
      .slice(0, 8)
      .map((inst) => linkFrom(inst, "institution"));
    const related = await hydrateWorks(
      [
        ...asListIds(entity.related_works),
        ...asListIds(entity.referenced_works),
      ],
      6,
    );
    const source = asRecord(asRecord(entity.primary_location)?.source);
    return {
      id,
      sourceId: String(entity.id ?? parsed.sourceId),
      kind: "work",
      name: cleanText(String(entity.display_name ?? "Untitled paper")),
      whyHere,
      hint: people
        .slice(0, 3)
        .map((p) => p.name)
        .join(", "),
      description: invertAbstract(
        asRecord(entity.abstract_inverted_index) as Record<string, number[]> | null,
      ),
      year: typeof entity.publication_year === "number" ? entity.publication_year : null,
      citedByCount: Number(entity.cited_by_count ?? 0),
      doi: entity.doi ? String(entity.doi) : null,
      url: entity.doi ? String(entity.doi) : null,
      path,
      place,
      lon: jittered.lon,
      lat: jittered.lat,
      topics,
      people,
      institutions,
      works: related.map((work) => linkFrom(work, "work")),
      sources: source ? [linkFrom(source, "source")] : [],
      alsoIn: [],
    };
  }

  if (parsed.kind === "author") {
    const authorFilter = [
      `authorships.author.id:${id.split(":")[1]}`,
      untilYear ? yearRangeFilter(untilYear) : null,
    ]
      .filter(Boolean)
      .join(",");
    const worksData = await catalogGet<CatalogPage>(
      `/works?filter=${encodeURIComponent(authorFilter)}&sort=cited_by_count:desc&per_page=8`,
    );
    const works = worksData.results ?? [];
    const authorSized = scaleCountsToYear(
      untilYear,
      Number.isFinite(Number(worksData.meta?.count)) ? Number(worksData.meta?.count) : undefined,
      Number(entity.works_count ?? 0),
      Number(entity.cited_by_count ?? 0),
    );
    const people = new Map<string, NeighborhoodLink>();
    for (const work of works) {
      for (const row of asList(work.authorships)) {
        const author = asRecord(row.author);
        if (!author) continue;
        const authorId = shortSourceId(String(author.id ?? ""));
        if (!authorId || authorId === id || people.has(authorId)) continue;
        people.set(authorId, linkFrom(author, "author"));
      }
    }
    const knownInstitutions = asList(entity.last_known_institutions);
    const affiliationInstitutions = asList(entity.affiliations)
      .map((row) => asRecord(row.institution))
      .filter((inst): inst is CatalogRecord => Boolean(inst));
    const institutions = (knownInstitutions.length ? knownInstitutions : affiliationInstitutions).map(
      (inst) => linkFrom(inst, "institution"),
    );
    return {
      id,
      sourceId: String(entity.id ?? parsed.sourceId),
      kind: "author",
      name: cleanText(String(entity.display_name ?? "Unknown researcher")),
      hint: institutions[0]?.name ?? null,
      whyHere,
      citedByCount: authorSized.citedByCount,
      worksCount: authorSized.worksCount,
      url: entity.orcid ? String(entity.orcid) : null,
      path,
      place,
      lon: jittered.lon,
      lat: jittered.lat,
      topics,
      people: [...people.values()].slice(0, 8),
      institutions,
      works: works.map((work) => linkFrom(work, "work")),
      sources: [],
      alsoIn: topics.slice(1),
    };
  }

  if (parsed.kind === "institution") {
    const instFilter = [
      `authorships.institutions.id:${id.split(":")[1]}`,
      untilYear ? yearRangeFilter(untilYear) : null,
    ]
      .filter(Boolean)
      .join(",");
    const worksData = await catalogGet<CatalogPage>(
      `/works?filter=${encodeURIComponent(instFilter)}&sort=cited_by_count:desc&per_page=8`,
    );
    const instSized = scaleCountsToYear(
      untilYear,
      Number.isFinite(Number(worksData.meta?.count)) ? Number(worksData.meta?.count) : undefined,
      Number(entity.works_count ?? 0),
      Number(entity.cited_by_count ?? 0),
    );
    const geo = asRecord(entity.geo);
    const hint = [geo?.city, geo?.country].filter(Boolean).join(", ") || String(entity.type ?? "");
    return {
      id,
      sourceId: String(entity.id ?? parsed.sourceId),
      kind: "institution",
      name: cleanText(String(entity.display_name ?? "Institution")),
      hint,
      whyHere,
      citedByCount: instSized.citedByCount,
      worksCount: instSized.worksCount,
      url: entity.homepage_url ? String(entity.homepage_url) : null,
      image: entity.image_thumbnail_url ? String(entity.image_thumbnail_url) : null,
      path,
      place,
      lon: jittered.lon,
      lat: jittered.lat,
      topics,
      people: [],
      institutions: [],
      works: (worksData.results ?? []).map((work) => linkFrom(work, "work")),
      sources: [],
      alsoIn: topics.slice(1),
    };
  }

  if (parsed.kind === "source") {
    const sourceFilter = [
      `primary_location.source.id:${id.split(":")[1]}`,
      untilYear ? yearRangeFilter(untilYear) : null,
    ]
      .filter(Boolean)
      .join(",");
    const worksData = await catalogGet<CatalogPage>(
      `/works?filter=${encodeURIComponent(sourceFilter)}&sort=cited_by_count:desc&per_page=8`,
    );
    const sourceSized = scaleCountsToYear(
      untilYear,
      Number.isFinite(Number(worksData.meta?.count)) ? Number(worksData.meta?.count) : undefined,
      Number(entity.works_count ?? 0),
      Number(entity.cited_by_count ?? 0),
    );
    return {
      id,
      sourceId: String(entity.id ?? parsed.sourceId),
      kind: "source",
      name: cleanText(String(entity.display_name ?? "Journal")),
      whyHere,
      hint: String(entity.type ?? "source"),
      citedByCount: sourceSized.citedByCount,
      worksCount: sourceSized.worksCount,
      url: entity.homepage_url ? String(entity.homepage_url) : null,
      path,
      place,
      lon: jittered.lon,
      lat: jittered.lat,
      topics,
      people: [],
      institutions: [],
      works: (worksData.results ?? []).map((work) => linkFrom(work, "work")),
      sources: [],
      alsoIn: topics,
    };
  }

  return {
    id,
    sourceId: String(entity.id ?? parsed.sourceId),
    kind: parsed.kind,
    name: String(entity.display_name ?? id),
    description: entity.description ? String(entity.description) : "",
    citedByCount: Number(entity.cited_by_count ?? 0),
    worksCount: Number(entity.works_count ?? 0),
    path,
    place,
    lon: jittered.lon,
    lat: jittered.lat,
    topics,
    people: [],
    institutions: [],
    works: [],
    sources: [],
    alsoIn: [],
  };
}

function asListIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function siblings(place: Place, byId: Map<string, Place>): Place[] {
  return [...byId.values()]
    .filter((other) => other.parentId === place.parentId && other.id !== place.id && other.kind === place.kind)
    .sort((a, b) => b.worksCount - a.worksCount);
}

export function yearRangeFilter(untilYear: number): string {
  return `publication_year:1800-${Math.round(untilYear)}`;
}

export async function landscapeWorks(
  year: number,
  filter: string | null,
): Promise<CatalogRecord[]> {
  const parts = [yearRangeFilter(year)];
  if (filter) parts.push(filter);
  const data = await catalogGet<{ results: CatalogRecord[] }>(
    `/works?filter=${encodeURIComponent(parts.join(","))}&sort=cited_by_count:desc&per_page=16&select=id,display_name,publication_year,cited_by_count,authorships,primary_topic,primary_location`,
  );
  return data.results ?? [];
}

export async function influentialWorks(filter: string | null, untilYear?: number): Promise<CatalogRecord[]> {
  const parts: string[] = [];
  if (untilYear) parts.push(yearRangeFilter(untilYear));
  if (filter) parts.push(filter);
  const query = parts.length
    ? `/works?filter=${encodeURIComponent(parts.join(","))}&sort=cited_by_count:desc&per_page=36&select=id,display_name,publication_year,cited_by_count,authorships,primary_topic,primary_location`
    : `/works?sort=cited_by_count:desc&per_page=24&select=id,display_name,publication_year,cited_by_count,authorships,primary_topic,primary_location`;
  const data = await catalogGet<{ results: CatalogRecord[] }>(query);
  return data.results ?? [];
}

export async function influentialWorksForPlace(
  place: Place,
  atlas: Atlas,
  untilYear?: number,
): Promise<CatalogRecord[]> {
  const main = await influentialWorks(catalogFilterForPlace(place), untilYear);
  const extras: CatalogRecord[] = [];
  if (place.kind === "subfield" || place.kind === "field") {
    const children = atlas.places
      .filter((row) => row.parentId === place.id && row.kind === "topic")
      .sort((a, b) => b.worksCount - a.worksCount)
      .slice(0, 5);
    if (children.length) {
      const featured = await Promise.all(
        children.map((row) =>
          influentialWorks(`primary_topic.id:${row.sourceId.split("/").pop()}`, untilYear),
        ),
      );
      extras.push(...featured.flatMap((list) => list.slice(0, 8)));
    }
  }
  const merged = new Map<string, CatalogRecord>();
  for (const work of [...main, ...extras]) {
    const id = String(work.id ?? "");
    const prev = merged.get(id);
    if (!prev || Number(work.cited_by_count ?? 0) > Number(prev.cited_by_count ?? 0)) {
      merged.set(id, work);
    }
  }
  return [...merged.values()]
    .filter((work) => {
      if (untilYear == null) return true;
      const published = work.publication_year;
      return typeof published !== "number" || published <= untilYear;
    })
    .sort((a, b) => Number(b.cited_by_count ?? 0) - Number(a.cited_by_count ?? 0))
    .slice(0, 40);
}

type GroupRow = {
  key: string;
  key_display_name?: string;
  count: number;
};

export async function fieldActivityForYear(year: number): Promise<{ id: string; name: string; count: number }[]> {
  return corpusThroughYear(year, "primary_topic.field.id");
}

export async function corpusThroughYear(
  year: number,
  groupBy: string,
): Promise<{ id: string; name: string; count: number }[]> {
  const data = await catalogGet<{ group_by?: GroupRow[] }>(
    `/works?filter=${yearRangeFilter(year)}&group_by=${groupBy}`,
  );
  return (data.group_by ?? []).map((row) => ({
    id: normalizeGroupId(row.key, groupBy),
    name: row.key_display_name ?? row.key,
    count: row.count,
  }));
}

function normalizeGroupId(key: string, groupBy: string): string {
  const short = shortSourceId(key);
  if (short.startsWith("field:") || short.startsWith("subfield:") || short.startsWith("topic:")) return short;
  if (groupBy.includes("subfield") && /^\d+$/.test(short)) return `subfield:${short}`;
  if (groupBy.includes("field") && /^\d+$/.test(short)) return `field:${short}`;
  if (short.startsWith("T")) return `topic:${short}`;
  return short;
}

export function workToPin(
  work: CatalogRecord,
  atlas: Atlas,
  byId: Map<string, Place>,
): {
  id: string;
  kind: EntityKind;
  name: string;
  lon: number;
  lat: number;
  hint?: string | null;
  citedByCount?: number;
  year?: number | null;
  placeId?: string | null;
} | null {
  const ids = topicIdsFrom(work);
  const place = locatePlace(byId, ids.topicId, ids.subfieldId, ids.fieldId, ids.domainId);
  if (!place) return null;
  const spread = Math.max(0.2, (place.radius || 0.4) * 0.78);
  const point = jitter(place.lon, place.lat, shortSourceId(String(work.id ?? "")), spread);
  const authors = asList(work.authorships)
    .map((row) => displayName(asRecord(row.author)))
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  return {
    id: shortSourceId(String(work.id ?? "")),
    kind: "work",
    name: cleanText(String(work.display_name ?? "Untitled")),
    lon: point.lon,
    lat: point.lat,
    hint: authors || place.name,
    citedByCount: Number(work.cited_by_count ?? 0),
    year: typeof work.publication_year === "number" ? work.publication_year : null,
    placeId: place.id,
  };
}

function placementCopy(kind: EntityKind, place: Place | null): string | null {
  if (!place) return null;
  if (kind === "institution") {
    return `Not a campus on Earth. This university is placed in ${place.name} because that is where most of its papers sit.`;
  }
  if (kind === "author") {
    return `Researchers live in the field of their most-cited work. This person is placed in ${place.name}.`;
  }
  if (kind === "work") {
    return `Papers sit in the topic assigned as their primary subject: ${place.name}.`;
  }
  if (kind === "source") {
    return `Journals are placed in the field they publish most: ${place.name}.`;
  }
  return null;
}

export function catalogFilterForPlace(place: Place | null): string | null {
  if (!place) return null;
  if (place.kind === "topic") return `primary_topic.id:${place.sourceId.split("/").pop()}`;
  if (place.kind === "subfield") return `primary_topic.subfield.id:${place.sourceId.split("/").pop()}`;
  if (place.kind === "field") return `primary_topic.field.id:${place.sourceId.split("/").pop()}`;
  if (place.kind === "domain") return `primary_topic.domain.id:${place.sourceId.split("/").pop()}`;
  return null;
}
