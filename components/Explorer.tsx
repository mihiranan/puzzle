"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cameraForPlace, jitter, nearestPlace, placeAtZoom, searchPlaces, zoomForKind } from "@/lib/atlas";
import { cleanText } from "@/lib/format";
import { usableMapView, useNarrow, useViewHeight } from "@/lib/viewport";
import {
  countsAtYear,
  ERA_MAX,
  ERA_MIN,
  fieldEraScale,
  isAliveInEra,
  isPlaceKind,
  visualsFromCounts,
  type EraSnapshots,
} from "@/lib/era-metrics";
import type {
  Atlas,
  EraLandscape,
  FlyTo,
  InspectedEntity,
  Pin,
  SearchHit,
} from "@/lib/types";
import Inspector from "./Inspector";
import SearchOmnibox from "./SearchOmnibox";
import SyncStatus from "./SyncStatus";
import Timeline from "./Timeline";

const KnowledgeMap = dynamic(() => import("./KnowledgeMap"), { ssr: false });

const PLAY_YEARS_PER_SECOND = 7;

export default function Explorer() {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const [atlasError, setAtlasError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [remoteSearch, setRemoteSearch] = useState<{ q: string; results: SearchHit[] } | null>(
    null,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [entity, setEntity] = useState<InspectedEntity | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityError, setEntityError] = useState<string | null>(null);
  const [pins, setPins] = useState<Pin[]>([]);
  const [era, setEra] = useState<EraLandscape | null>(null);
  const [eraLoading, setEraLoading] = useState(false);
  const [flyTo, setFlyTo] = useState<FlyTo | null>(null);
  const [year, setYear] = useState(ERA_MAX);
  const [playing, setPlaying] = useState(false);
  const [snapshots, setSnapshots] = useState<EraSnapshots | null>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [view, setView] = useState({ lon: 6, lat: 10, zoom: 2.58 });
  const [welcome, setWelcome] = useState(true);
  const [atlasRefreshing, setAtlasRefreshing] = useState(false);
  const [papersLoading, setPapersLoading] = useState(false);
  const [sheetRatio, setSheetRatio] = useState(0.58);
  const [sheetHidden, setSheetHidden] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetDrag = useRef<{ startY: number; startRatio: number } | null>(null);
  const narrow = useNarrow();
  const viewHeight = useViewHeight();

  const yearRef = useRef(year);
  const entityReq = useRef(0);
  const entityIdRef = useRef<string | null>(null);

  useEffect(() => {
    yearRef.current = year;
  }, [year]);

  useEffect(() => {
    entityIdRef.current = entity?.id ?? null;
  }, [entity?.id]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/eras")
      .then((res) => {
        if (!res.ok) throw new Error("Could not load eras");
        return res.json();
      })
      .then((data: EraSnapshots) => {
        if (!cancelled) setSnapshots(data);
      })
      .catch((error) => console.error(error));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const stamp = { current: null as string | null };
    let delay = 60_000;
    let timer = 0;

    const applyAtlas = (data: Atlas) => {
      stamp.current = data.generatedAt;
      setAtlas(data);
      setAtlasError(null);
    };

    const loadAtlasPayload = async (generatedAt?: string | null) => {
      const urls = generatedAt
        ? [`/data/atlas.json?v=${encodeURIComponent(generatedAt)}`, "/api/atlas"]
        : ["/data/atlas.json", "/api/atlas"];
      let lastError: Error | null = null;
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error("Atlas is still being drawn.");
          const data = (await res.json()) as Atlas;
          if (!data?.places?.length) throw new Error("Atlas is still being drawn.");
          if (!cancelled) applyAtlas(data);
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error("Atlas is still being drawn.");
        }
      }
      throw lastError ?? new Error("Atlas is still being drawn.");
    };

    const checkForUpdate = async () => {
      try {
        const res = await fetch("/api/atlas/status", { cache: "no-store" });
        if (!res.ok) throw new Error("status");
        const meta = (await res.json()) as {
          generatedAt?: string | null;
          refreshing?: boolean;
        };
        if (cancelled) return;
        setAtlasRefreshing(Boolean(meta.refreshing));
        delay = meta.refreshing ? 2500 : 60_000;
        if (meta.generatedAt && meta.generatedAt !== stamp.current) {
          await loadAtlasPayload(meta.generatedAt);
        }
      } catch {
        if (!cancelled) setAtlasRefreshing(false);
        delay = Math.min(Math.round(delay * 1.4), 60_000);
      }
    };

    const schedule = () => {
      timer = window.setTimeout(async () => {
        await checkForUpdate();
        if (!cancelled) schedule();
      }, delay);
    };

    loadAtlasPayload().catch((error: Error) => {
      if (!cancelled) setAtlasError(error.message);
    });
    void checkForUpdate().then(() => {
      if (!cancelled) schedule();
    });

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      void checkForUpdate().then(() => {
        if (!cancelled) schedule();
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const eraCounts = useMemo(() => {
    if (!snapshots) return null;
    const raw = countsAtYear(snapshots, year);
    if (!atlas) return raw;
    const rolled = { ...raw };
    for (const place of atlas.places) {
      if (place.kind !== "field" || !place.domainId) continue;
      rolled[place.domainId] = (rolled[place.domainId] ?? 0) + (raw[place.id] ?? 0);
    }
    return rolled;
  }, [snapshots, year, atlas]);

  const localResults = useMemo<SearchHit[]>(() => {
    if (!atlas || query.trim().length < 2) return [];
    return searchPlaces(atlas, query, 6).map((place) => {
      const works = eraCounts ? Math.round(eraCounts[place.id] ?? 0) : place.worksCount;
      const cites =
        eraCounts && place.worksCount > 0
          ? Math.round(place.citedByCount * Math.min(1, works / place.worksCount))
          : place.citedByCount;
      return {
        id: place.id,
        sourceId: place.sourceId,
        kind: place.kind,
        name: place.name,
        hint: place.description || place.kind,
        citedByCount: cites,
        worksCount: works,
        placeId: place.id,
      };
    });
  }, [atlas, query, eraCounts]);

  const results = useMemo(() => {
    const base = remoteSearch && remoteSearch.q === query.trim() ? remoteSearch.results : localResults;
    if (!eraCounts) return base;
    return base.map((hit) => {
      if (!isPlaceKind(hit.kind)) return hit;
      const works = Math.round(eraCounts[hit.id] ?? 0);
      const allWorks = hit.worksCount ?? 0;
      return {
        ...hit,
        worksCount: works,
        citedByCount:
          allWorks > 0 ? Math.round((hit.citedByCount ?? 0) * Math.min(1, works / allWorks)) : 0,
      };
    });
  }, [remoteSearch, query, localResults, eraCounts]);

  useEffect(() => {
    if (!atlas) return;
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as { results: SearchHit[] };
        setRemoteSearch({ q: query.trim(), results: data.results ?? [] });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error(error);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [atlas, query]);

  const openEntity = useCallback(
    async (id: string, shouldFly = true) => {
      const req = ++entityReq.current;
      setWelcome(false);
      setSearchOpen(false);
      if (shouldFly) {
        setSheetHidden(false);
        setSheetRatio(0.58);
      }
      setEntityLoading(true);
      setEntityError(null);
      if (shouldFly && atlas) {
        const home = atlas.places.find((place) => place.id === id);
        if (home) {
          const fit = cameraForPlace(
            atlas,
            home,
            usableMapView(undefined, undefined, true, sheetRatio > 0.66),
          );
          setFlyTo({ id: `${id}:${Date.now()}`, lon: fit.lon, lat: fit.lat, zoom: fit.zoom });
        }
      }
      try {
        const until = Math.round(yearRef.current);
        const res = await fetch(
          `/api/entity?id=${encodeURIComponent(id)}&until=${until}`,
        );
        const data = (await res.json()) as InspectedEntity & { error?: string };
        if (req !== entityReq.current) return;
        if (!res.ok) throw new Error(data.error || "Could not locate that place.");
        setEntity(data);
        const pin: Pin = {
          id: data.id,
          kind: data.kind,
          name: data.name,
          lon: data.lon,
          lat: data.lat,
          hint: data.hint,
          citedByCount: data.citedByCount,
          year: data.year,
          emphasis: true,
        };
        const neighborPins: Pin[] = [];
        if (data.kind === "work") {
          for (const person of data.people) {
            const point = jitter(data.lon, data.lat, person.id, 0.22);
            neighborPins.push({
              id: person.id,
              kind: "author",
              name: person.name,
              lon: point.lon,
              lat: point.lat,
              hint: "Contributor",
            });
          }
        }
        if (req !== entityReq.current) return;
        setPins(dedupePins([pin, ...neighborPins]));
        if (shouldFly && !atlas?.places.some((place) => place.id === data.id)) {
          const home = data.place;
          const fit =
            atlas && home
              ? cameraForPlace(atlas, home, usableMapView(undefined, undefined, true, sheetRatio > 0.66))
              : { lon: data.lon, lat: data.lat, zoom: zoomForKind(data.kind) };
          setFlyTo({
            id: `${data.id}:${Date.now()}`,
            lon: fit.lon,
            lat: fit.lat,
            zoom: fit.zoom,
          });
        }
      } catch (error) {
        if (req !== entityReq.current) return;
        if (entityIdRef.current !== id) {
          setEntityError(error instanceof Error ? error.message : "Could not locate that place.");
        }
      } finally {
        if (req === entityReq.current) setEntityLoading(false);
      }
    },
    [atlas, sheetRatio],
  );

  const settledYear = playing ? null : Math.round(year);

  useEffect(() => {
    if (!atlas || settledYear == null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setEraLoading(true);
      try {
        const params = new URLSearchParams({ year: String(settledYear) });
        const place = placeAtZoom(atlas, view.lon, view.lat, view.zoom);
        if (place && view.zoom >= 2.6) params.set("place", place.id);
        const res = await fetch(`/api/landscape?${params}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as EraLandscape;
        setEra(data);
        setPins((current) => {
          const keep = current.filter((pin) => pin.emphasis || pin.kind === "author");
          return dedupePins([...keep, ...(data.pins ?? [])]);
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error(error);
      } finally {
        if (!controller.signal.aborted) setEraLoading(false);
      }
    }, 220);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [atlas, settledYear, view.lon, view.lat, view.zoom]);

  useEffect(() => {
    if (!atlas || view.zoom < 4.8 || !focusId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setPapersLoading(true);
      try {
        const res = await fetch(
          `/api/papers?place=${encodeURIComponent(focusId)}&until=${Math.round(yearRef.current)}`,
          {
            signal: controller.signal,
          },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { pins: Pin[] };
        setPins((current) => {
          const keep = current.filter((pin) => pin.emphasis || pin.kind === "author");
          return dedupePins([...keep, ...(data.pins ?? [])]);
        });
      } catch (error) {
        if ((error as Error).name !== "AbortError") console.error(error);
      } finally {
        if (!controller.signal.aborted) setPapersLoading(false);
      }
    }, 240);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [atlas, focusId, view.zoom, settledYear]);

  useEffect(() => {
    if (!playing) return;
    if (yearRef.current >= ERA_MAX - 0.05) {
      yearRef.current = ERA_MIN;
      setYear(ERA_MIN);
    }
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = yearRef.current + dt * PLAY_YEARS_PER_SECOND;
      if (next >= ERA_MAX) {
        yearRef.current = ERA_MAX;
        setYear(ERA_MAX);
        setPlaying(false);
        return;
      }
      yearRef.current = next;
      setYear(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const closeInspector = useCallback(() => {
    entityReq.current += 1;
    setEntity(null);
    setEntityError(null);
    setEntityLoading(false);
    setSheetHidden(false);
    setSheetRatio(0.58);
    setPins((current) => current.filter((pin) => !pin.emphasis));
  }, []);

  const grabSheet = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const startY = event.clientY;
      const startRatio = sheetRatio;
      sheetDrag.current = { startY, startRatio };
      setSheetDragging(true);
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const onMove = (move: PointerEvent) => {
        const next = Math.max(0.2, Math.min(0.84, startRatio - (move.clientY - startY) / viewHeight));
        setSheetRatio(next);
      };
      const onUp = (up: PointerEvent) => {
        target.releasePointerCapture(up.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        setSheetDragging(false);
        sheetDrag.current = null;
        const next = startRatio - (up.clientY - startY) / viewHeight;
        if (next < 0.26 || (up.clientY - startY > 90 && startRatio < 0.5)) {
          setSheetHidden(true);
          setSheetRatio(0.58);
          return;
        }
        if (next > 0.72) setSheetRatio(0.8);
        else if (next > 0.54) setSheetRatio(0.62);
        else setSheetRatio(0.48);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [sheetRatio, viewHeight],
  );

  const openId = entity?.id;
  useEffect(() => {
    if (!openId || settledYear == null) return;
    const timer = window.setTimeout(() => {
      void openEntity(openId, false);
    }, 0);
    return () => window.clearTimeout(timer);
    // Refetch the open file when the year settles. Do not depend on openEntity or the
    // entity id — opening already fetches, and openEntity's identity changes often.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledYear]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (welcome && (event.key === "Enter" || event.key === "NumpadEnter")) {
        event.preventDefault();
        setWelcome(false);
        return;
      }
      if (event.key !== "Escape") return;
      if (searchOpen) {
        setSearchOpen(false);
        return;
      }
      if (entity || entityError) {
        event.preventDefault();
        closeInspector();
        return;
      }
      if (welcome) setWelcome(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, entity, entityError, welcome, closeInspector]);

  const interpolated = useMemo(() => {
    if (!snapshots || !eraCounts) return null;
    return visualsFromCounts(eraCounts, snapshots);
  }, [snapshots, eraCounts]);

  const activity = useMemo(
    () => ({
      ...(interpolated?.domainActivity ?? era?.domainActivity ?? {}),
      ...(interpolated?.fieldActivity ?? era?.fieldActivity ?? {}),
    }),
    [interpolated, era],
  );
  const growth = useMemo(
    () => ({
      ...(interpolated?.domainGrowth ?? era?.domainGrowth ?? {}),
      ...(interpolated?.fieldGrowth ?? era?.fieldGrowth ?? {}),
    }),
    [interpolated, era],
  );

  const wander = useCallback(() => {
    if (!atlas) return;
    const pool = atlas.places.filter(
      (place) => place.kind === "subfield" && place.worksCount > 80_000,
    );
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? atlas.places[0];
    void openEntity(pick.id);
  }, [atlas, openEntity]);

  if (atlasError) {
    return (
      <main className="flex h-full items-center justify-center px-6 text-center">
        <div className="hud-boot">
          <p className="font-[family-name:var(--font-display)] text-4xl tracking-wide">Atlas offline</p>
          <p className="mt-3 text-sm text-[var(--muted)]">{atlasError} Run `npm run atlas`.</p>
        </div>
      </main>
    );
  }

  if (!atlas) {
    return (
      <main className="relative flex h-full flex-col items-center justify-center gap-4">
        <div className="hud-scan" />
        <p className="font-[family-name:var(--font-display)] text-6xl tracking-[0.18em]">PUZZLE</p>
        <p className="flex items-center gap-2 text-sm tracking-[0.18em] text-[var(--muted)] uppercase">
          <span className="sync-spinner" aria-hidden />
          Drawing the map
        </p>
      </main>
    );
  }

  const here = atlas
    ? placeAtZoom(atlas, view.lon, view.lat, view.zoom, (place) => {
        if (!isAliveInEra(place.id, place.kind, year, eraCounts)) return false;
        const fieldId = place.kind === "field" ? place.id : place.fieldId;
        return fieldEraScale(fieldId, growth, eraCounts != null) > 0;
      })
    : null;
  const crumb = here ?? (atlas ? nearestPlace(atlas, view.lon, view.lat, "domain") : null);
  const loc = hoverName ?? crumb?.name ?? "Scan a region";
  const dossierOpen = Boolean(entity || entityLoading || entityError);
  const sheetH = !narrow || !dossierOpen ? 0 : sheetHidden ? 52 : viewHeight * sheetRatio;
  const bottomInset = narrow ? Math.round(sheetH + 68) : 0;
  const eraProps = {
    year: Math.round(year),
    playing,
    min: ERA_MIN,
    max: ERA_MAX,
    onYear: (next: number) => {
      setPlaying(false);
      yearRef.current = next;
      setYear(next);
    },
    onPlaying: setPlaying,
  };

  return (
    <main
      className="relative h-full w-full"
      style={{
        ["--chrome-right" as string]: dossierOpen && !narrow ? "27rem" : "0px",
        ["--chrome-bottom" as string]: `${bottomInset}px`,
      }}
    >
      <KnowledgeMap
        atlas={atlas}
        pins={pins}
        selectedId={entity?.id ?? null}
        flyTo={flyTo}
        activity={activity}
        growth={growth}
        eraCounts={eraCounts}
        year={year}
        playing={playing}
        bottomInset={bottomInset}
        onSelect={(id) => void openEntity(id)}
        onHover={setHoverName}
        onFocusPlace={setFocusId}
        onViewChange={(lon, lat, zoom) => setView({ lon, lat, zoom })}
        onReset={() => {
          closeInspector();
          setSearchOpen(false);
        }}
      />

      <div className="hud-vignette" />
      <div className="hud-viewfinder">
        <span />
      </div>
      <div className="hud-scan" />

      <header className="search-shell pointer-events-none absolute z-40 flex flex-col items-stretch gap-2 md:z-20 md:gap-3">
        <div className="relative">
          <p className="pointer-events-auto font-[family-name:var(--font-display)] text-[1.35rem] leading-none tracking-[0.18em] sm:text-[1.65rem] sm:tracking-[0.2em]">
            PUZZLE
          </p>
          <div className="pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2">
            <SyncStatus
              compact={narrow}
              atlasRefreshing={atlasRefreshing}
              entityLoading={entityLoading}
              eraLoading={narrow ? false : eraLoading}
              papersLoading={narrow ? false : view.zoom >= 4.8 && papersLoading}
            />
          </div>
        </div>
        <SearchOmnibox
          query={query}
          onQuery={setQuery}
          results={results}
          open={searchOpen}
          onOpen={setSearchOpen}
          activeIndex={activeIndex}
          onActiveIndex={setActiveIndex}
          onChoose={(hit) => void openEntity(hit.id)}
          loading={searchLoading}
        />
      </header>

      {dossierOpen && !narrow && (
        <div className="pointer-events-none absolute inset-y-3 right-3 z-30 flex w-[min(100%,26rem)] flex-col gap-2">
          <Inspector
            entity={entity}
            loading={entityLoading}
            error={entityError}
            year={Math.round(year)}
            eraCounts={eraCounts}
            onClose={closeInspector}
            onOpen={(id) => void openEntity(id)}
          />
          <Timeline {...eraProps} />
        </div>
      )}

      {dossierOpen && narrow && sheetHidden && (
        <button
          type="button"
          className="hud-bar pointer-events-auto fixed inset-x-2 z-50 flex items-center justify-between gap-3 px-3 py-2.5"
          style={{ bottom: "calc(3.65rem + max(0.45rem, env(safe-area-inset-bottom)))" }}
          onClick={() => setSheetHidden(false)}
        >
          <span className="min-w-0 truncate text-left">
            <span className="block font-[family-name:var(--font-display)] text-[15px] tracking-wide">
              {entity ? cleanText(entity.name) : "Details"}
            </span>
            <span className="block font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--muted)]">
              Tap to show details
            </span>
          </span>
          <span className="shrink-0 text-[var(--signal)]">⌃</span>
        </button>
      )}

      {dossierOpen && narrow && !sheetHidden && (
        <div
          className="pointer-events-none fixed inset-x-2 z-50 flex flex-col"
          style={{
            bottom: "calc(3.65rem + max(0.45rem, env(safe-area-inset-bottom)))",
            height: `${Math.round(viewHeight * sheetRatio)}px`,
            transition: sheetDragging ? "none" : "height 220ms ease",
          }}
        >
          <Inspector
            entity={entity}
            loading={entityLoading}
            error={entityError}
            year={Math.round(year)}
            eraCounts={eraCounts}
            onClose={closeInspector}
            onOpen={(id) => void openEntity(id)}
            mobile
            onGrab={grabSheet}
            onMinimize={() => setSheetHidden(true)}
          />
        </div>
      )}

      {(!dossierOpen || narrow) && (
        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-[35] flex flex-col gap-1.5 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:z-20 md:flex-row md:items-end md:justify-between md:gap-3 md:p-4 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="pointer-events-none hidden max-w-sm truncate text-[12px] tracking-wide text-[var(--muted)] md:block">
            {loc}
          </p>
          <div className="w-full md:max-w-xl md:ml-auto">
            <Timeline {...eraProps} />
          </div>
        </footer>
      )}

      {welcome && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#050403]/80 p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-[4px] sm:p-6">
          <div className="hud-panel hud-boot w-full max-w-xl px-5 py-8 text-center sm:px-12 sm:py-10">
            <div className="hud-panel-feet pointer-events-none absolute inset-0" />
            <p className="text-[10px] tracking-[0.28em] text-[var(--signal)] uppercase sm:text-[11px]">
              Knowledge, in pieces
            </p>
            <h1 className="mt-3 font-[family-name:var(--font-display)] text-5xl leading-none tracking-[0.18em] sm:text-7xl">
              PUZZLE
            </h1>
            <p className="mx-auto mt-5 max-w-md text-[14px] leading-6 text-[var(--ink)]/88 sm:mt-6 sm:text-[15px] sm:leading-7">
              Every field is a piece of one picture. Tap a piece, pinch to move, search anyone, slide through time.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:justify-center">
              <button
                type="button"
                autoFocus={!narrow}
                onClick={() => setWelcome(false)}
                className="min-h-12 border border-[var(--signal)] bg-[var(--signal)] px-6 py-3 text-[15px] tracking-[0.08em] text-[#140c06] hover:bg-[var(--signal-hot)] sm:text-[13px]"
              >
                Begin
              </button>
              <button
                type="button"
                onClick={wander}
                className="min-h-12 border border-[var(--line)] px-6 py-3 text-[15px] tracking-[0.08em] hover:border-[var(--signal)] hover:text-[var(--signal-hot)] sm:text-[13px]"
              >
                Wander
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function dedupePins(pins: Pin[]): Pin[] {
  const seen = new Set<string>();
  const unique: Pin[] = [];
  for (const pin of pins) {
    if (seen.has(pin.id)) continue;
    seen.add(pin.id);
    unique.push(pin);
  }
  return unique;
}
