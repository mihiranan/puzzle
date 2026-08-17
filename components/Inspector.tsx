"use client";

import { useState } from "react";
import { citesThroughYear, isAliveInEra, isPlaceKind, worksThroughYear } from "@/lib/era-metrics";
import { cleanText, compactNumber, kindLabel, polishCopy } from "@/lib/format";
import type { InspectedEntity, NeighborhoodLink } from "@/lib/types";

type Tab = "intel" | "assets" | "crew" | "terrain";

type Props = {
  entity: InspectedEntity | null;
  loading: boolean;
  error: string | null;
  year?: number;
  eraCounts?: Record<string, number> | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  mobile?: boolean;
  onGrab?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onMinimize?: () => void;
};

export default function Inspector({
  entity,
  loading,
  error,
  year,
  eraCounts,
  onClose,
  onOpen,
  mobile = false,
  onGrab,
  onMinimize,
}: Props) {
  const [tabState, setTabState] = useState<{ id: string | null; tab: Tab }>({
    id: null,
    tab: "intel",
  });
  const tab = entity && tabState.id === entity.id ? tabState.tab : "intel";
  const setTab = (next: Tab) => {
    if (entity) setTabState({ id: entity.id, tab: next });
  };

  if (!entity && !loading && !error) return null;

  const papers = entity ? papersThrough(entity.works, year) : [];
  const journals = entity ? uniqueItems(entity.sources) : [];
  const people = entity ? uniqueItems(entity.people) : [];
  const institutions = entity ? uniqueItems(entity.institutions) : [];
  const inside = entity ? eraSizedLinks(alivePlaces(entity.topics, year, eraCounts), eraCounts) : [];
  const nearby = entity ? eraSizedLinks(alivePlaces(entity.alsoIn, year, eraCounts), eraCounts) : [];
  const shownWorks =
    entity && isPlaceKind(entity.kind)
      ? worksThroughYear(entity.id, eraCounts, entity.worksCount)
      : entity?.worksCount;
  const shownCites =
    entity && isPlaceKind(entity.kind)
      ? citesThroughYear(
          entity.place?.citedByCount ?? entity.citedByCount,
          shownWorks,
          entity.place?.worksCount ?? entity.worksCount,
        )
      : entity?.citedByCount;
  const paperCount = papers.length + journals.length;
  const peopleCount = people.length + institutions.length;
  const nearbyCount = inside.length + nearby.length;

  return (
    <aside className="hud-panel panel-in sheet pointer-events-auto flex min-h-0 flex-1 flex-col overflow-hidden select-text">
      <div className="hud-panel-feet pointer-events-none absolute inset-0" />

      {mobile && (
        <button
          type="button"
          className="flex shrink-0 touch-none items-center justify-center pb-1.5 pt-2.5"
          aria-label="Drag to resize details"
          onPointerDown={onGrab}
        >
          <span className="block h-1.5 w-12 rounded-full bg-[var(--line-strong)]" />
        </button>
      )}

      <header className="shrink-0 border-b border-[var(--line)] px-3 py-2 md:px-4 md:py-3">
        <div className="mb-1 flex items-center justify-between gap-3 md:mb-2">
          <span className="kind-pill">{entity ? kindLabel(entity.kind) : loading ? "Loading" : "Missing"}</span>
          <span className="flex items-center gap-1.5">
            {mobile && onMinimize && (
              <button
                type="button"
                onClick={onMinimize}
                className="inline-flex min-h-10 min-w-10 items-center justify-center border border-[var(--line)] text-[15px] text-[var(--muted)] hover:text-[var(--signal-hot)]"
                aria-label="Hide details"
              >
                –
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 min-w-10 items-center justify-center border border-[var(--line)] px-2 py-1 font-[family-name:var(--font-geist-mono)] text-[13px] tracking-[0.16em] text-[var(--muted)] hover:text-[var(--signal-hot)] md:min-h-9 md:min-w-9 md:text-[10px]"
              aria-label="Close inspector"
            >
              <span className="md:hidden">✕</span>
              <span className="hidden md:inline">ESC</span>
            </button>
          </span>
        </div>
        <h2 className="truncate font-[family-name:var(--font-display)] text-[1.15rem] leading-tight tracking-wide md:text-[1.65rem] md:whitespace-normal">
          {entity ? cleanText(entity.name) : loading ? "Finding this place…" : "Could not open"}
        </h2>
      </header>
      {loading && <div className="sync-rail shrink-0" aria-hidden />}

      {entity && (
        <Telemetry
          entity={entity}
          works={shownWorks}
          cites={shownCites}
          year={year}
          onOpen={onOpen}
        />
      )}

      {entity && (
        <nav className="flex shrink-0 border-b border-[var(--line)]">
          {(
            [
              ["intel", "Overview"],
              ["assets", tabLabel("Papers", paperCount)],
              ["crew", tabLabel("People", peopleCount)],
              ["terrain", tabLabel("Nearby", nearbyCount)],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`dossier-tab ${tab === id ? "is-live" : ""}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 scrollbar-thin md:px-4 md:py-3">
        {error && <p className="text-sm text-[#ff8a5c]">{error}</p>}
        {loading && !entity && (
          <p className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <span className="sync-spinner" aria-hidden />
            Reading this place…
          </p>
        )}
        {entity && tab === "intel" && (
          <IntelTab entity={entity} papers={papers} inside={inside} onOpen={onOpen} />
        )}
        {entity && tab === "assets" && (
          <>
            <Section title="Influential papers" items={papers} onOpen={onOpen} numbered />
            <Section title="Journals" items={journals} onOpen={onOpen} />
            {paperCount === 0 && (
              <Empty
                text={
                  year != null
                    ? `No papers or journals listed for ${year} or earlier.`
                    : "No papers listed."
                }
              />
            )}
          </>
        )}
        {entity && tab === "crew" && (
          <>
            <Section
              title={entity.kind === "work" ? "Authors" : "Researchers"}
              items={people}
              onOpen={onOpen}
            />
            <Section title="Institutions" items={institutions} onOpen={onOpen} />
            {peopleCount === 0 && <Empty text="No people or institutions listed." />}
          </>
        )}
        {entity && tab === "terrain" && (
          <>
            <Section title="Inside" items={inside} onOpen={onOpen} />
            <Section title="Nearby fields" items={nearby} onOpen={onOpen} />
            {nearbyCount === 0 && <Empty text="No neighboring pieces listed." />}
          </>
        )}
      </div>
    </aside>
  );
}

function Telemetry({
  entity,
  works,
  cites,
  year,
  onOpen,
}: {
  entity: InspectedEntity;
  works?: number;
  cites?: number;
  year?: number;
  onOpen: (id: string) => void;
}) {
  const stats = [
    works != null ? `${compactNumber(works)} works` : null,
    cites != null ? `${compactNumber(cites)} cites` : null,
    entity.year != null ? String(entity.year) : null,
  ].filter(Boolean);

  return (
    <div className="shrink-0 border-b border-[var(--line)] px-3 py-1.5 md:px-4 md:py-2">
      {stats.length > 0 && (
        <p className="mb-1 font-[family-name:var(--font-geist-mono)] text-[10px] tracking-wide text-[var(--muted)] md:hidden">
          {stats.join(" · ")}
          {year != null && isPlaceKind(entity.kind) ? ` · through ${year}` : ""}
        </p>
      )}
      <div className="mb-2 hidden grid-cols-3 gap-2 md:grid">
        {works != null && (
          <Meter label={year != null && isPlaceKind(entity.kind) ? `Works · ${year}` : "Works"} value={compactNumber(works)} />
        )}
        {cites != null && <Meter label="Citations" value={compactNumber(cites)} />}
        {entity.year != null && <Meter label="Year" value={String(entity.year)} />}
        {works == null && cites == null && entity.year == null && (
          <Meter label="Grid" value={`${entity.lon.toFixed(1)} / ${entity.lat.toFixed(1)}`} />
        )}
      </div>
      {entity.path.length > 0 && (
        <p className="truncate font-[family-name:var(--font-geist-mono)] text-[10px] leading-4 tracking-wide text-[var(--muted)] md:mt-0">
          {entity.path.map((place, index) => (
            <span key={place.id}>
              {index > 0 && <span className="mx-1 text-[var(--signal)]/60">›</span>}
              <button type="button" onClick={() => onOpen(place.id)} className="hover:text-[var(--signal-hot)]">
                {place.name}
              </button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function tabLabel(name: string, count: number) {
  return count > 0 ? `${name} ${count}` : name;
}

function IntelTab({
  entity,
  papers,
  inside,
  onOpen,
}: {
  entity: InspectedEntity;
  papers: NeighborhoodLink[];
  inside: NeighborhoodLink[];
  onOpen: (id: string) => void;
}) {
  return (
    <>
      {entity.whyHere && (
        <p className="mb-3 border border-[var(--line)] px-3 py-2 text-[12px] leading-5 text-[var(--muted)]">
          {polishCopy(entity.whyHere)}
        </p>
      )}
      {entity.hint && !entity.whyHere && (
        <p className="mb-3 text-[12px] text-[var(--muted)]">{polishCopy(entity.hint)}</p>
      )}
      {entity.description && (
        <p className="intel-copy mb-4 text-sm leading-6 text-[var(--ink)]/85">
          {polishCopy(entity.description)}
        </p>
      )}
      <Section title="Influential papers" items={papers.slice(0, 5)} onOpen={onOpen} numbered />
      <Section title="Inside" items={inside.slice(0, 5)} onOpen={onOpen} />
      {entity.url && (
        <a
          href={entity.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-[family-name:var(--font-geist-mono)] text-[11px] tracking-[0.1em] text-[var(--signal)] hover:text-[var(--signal-hot)]"
        >
          Open source record →
        </a>
      )}
    </>
  );
}

function papersThrough(items: NeighborhoodLink[], year?: number): NeighborhoodLink[] {
  const rows = uniqueItems(items);
  if (year == null) return rows;
  return rows.filter((item) => item.year == null || item.year <= year);
}

function alivePlaces(
  items: NeighborhoodLink[],
  year?: number,
  eraCounts?: Record<string, number> | null,
): NeighborhoodLink[] {
  if (year == null) return items;
  return items.filter((item) => isAliveInEra(item.id, item.kind, year, eraCounts ?? null));
}

function Meter({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[var(--line)] bg-[rgba(232,135,42,0.04)] px-2 py-1.5">
      <div className="font-[family-name:var(--font-geist-mono)] text-[9px] uppercase tracking-[0.16em] text-[var(--signal)]">
        {label}
      </div>
      <div className="font-[family-name:var(--font-display)] text-lg leading-tight tracking-wide">{value}</div>
    </div>
  );
}

function Empty({ text = "Nothing listed here." }: { text?: string }) {
  return <p className="text-sm text-[var(--muted)]">{text}</p>;
}

function eraSizedLinks(
  items: NeighborhoodLink[],
  eraCounts?: Record<string, number> | null,
): NeighborhoodLink[] {
  return items.map((item) => {
    if (!isPlaceKind(item.kind)) return item;
    const works = worksThroughYear(item.id, eraCounts, item.worksCount);
    return {
      ...item,
      worksCount: works,
      citedByCount: citesThroughYear(item.citedByCount, works, item.worksCount),
    };
  });
}

function uniqueItems(items: NeighborhoodLink[]): NeighborhoodLink[] {
  const seen = new Set<string>();
  const unique: NeighborhoodLink[] = [];
  for (const item of items) {
    const key = item.id || `${item.kind}:${item.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function Section({
  title,
  items,
  onOpen,
  numbered = false,
}: {
  title: string;
  items: NeighborhoodLink[];
  onOpen: (id: string) => void;
  numbered?: boolean;
}) {
  const rows = uniqueItems(items);
  if (!rows.length) return null;
  return (
    <section className="mb-4">
      <h3 className="mb-2 font-[family-name:var(--font-geist-mono)] text-[10px] uppercase tracking-[0.18em] text-[var(--signal)]">
        {title}
      </h3>
      <ul>
        {rows.map((item, index) => (
          <li key={`${item.id}-${index}`}>
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="dossier-row flex min-h-11 w-full items-start gap-2 px-1 py-2 text-left md:min-h-0 md:py-1.5"
            >
              {numbered && (
                <span className="w-5 shrink-0 font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--signal)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug">{cleanText(item.name)}</span>
                <span className="block font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--muted)]">
                  {kindLabel(item.kind)}
                  {item.year ? ` · ${item.year}` : ""}
                  {isPlaceKind(item.kind) && item.worksCount != null
                    ? ` · ${compactNumber(item.worksCount)} works`
                    : item.citedByCount
                      ? ` · ${compactNumber(item.citedByCount)} cites`
                      : ""}
                  {item.hint ? ` · ${cleanText(item.hint)}` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
