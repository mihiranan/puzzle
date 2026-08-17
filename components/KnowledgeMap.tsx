"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fieldEraScale, isAliveInEra } from "@/lib/era-metrics";
import {
  clampCamera,
  INITIAL_CAMERA,
  pixelsPerDegree,
  project,
  unproject,
  type Camera,
} from "@/lib/camera";
import { cleanText, compactNumber } from "@/lib/format";
import { domainPaint, featureAtPoint, featureTint, featuresFromCollection, shadeHex } from "@/lib/geo";
import { fillItemsInRing } from "@/lib/tessellate";
import type { Atlas, FlyTo, Pin } from "@/lib/types";

type Props = {
  atlas: Atlas;
  pins: Pin[];
  selectedId: string | null;
  flyTo: FlyTo | null;
  activity: Record<string, number>;
  growth: Record<string, number>;
  eraCounts: Record<string, number> | null;
  year: number;
  playing: boolean;
  onSelect: (id: string) => void;
  onHover: (name: string | null) => void;
  onFocusPlace: (id: string | null) => void;
  onViewChange: (lon: number, lat: number, zoom: number) => void;
  onReset?: () => void;
  bottomInset?: number;
};

type Label = {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  focused?: boolean;
};

export default function KnowledgeMap({
  atlas,
  pins,
  selectedId,
  flyTo,
  activity,
  growth,
  eraCounts,
  year,
  playing,
  onSelect,
  onHover,
  onFocusPlace,
  onViewChange,
  onReset,
  bottomInset = 0,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1200, height: 800 });
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);
  const [enteredId, setEnteredId] = useState<string | null>(null);
  const [listHoverId, setListHoverId] = useState<string | null>(null);
  const cursorTick = useRef(0);
  const [camera, setCamera] = useState<Camera>(INITIAL_CAMERA);
  const displayRef = useRef<Camera>(INITIAL_CAMERA);
  const targetRef = useRef<Camera>(INITIAL_CAMERA);
  const sizeRef = useRef(size);
  const anchorRef = useRef<{ x: number; y: number; lon: number; lat: number } | null>(null);
  const rafRef = useRef(0);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    lon: number;
    lat: number;
    moved: boolean;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const onFocusRef = useRef(onFocusPlace);
  const onViewRef = useRef(onViewChange);
  const onResetRef = useRef(onReset);
  const landRef = useRef<SVGGElement>(null);
  const labelLayerRef = useRef<HTMLDivElement>(null);
  const labelCamRef = useRef<Camera>(INITIAL_CAMERA);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{
    startDist: number;
    startZoom: number;
    midX: number;
    midY: number;
    lon: number;
    lat: number;
  } | null>(null);
  const pinchedRef = useRef(false);
  const canHoverRef = useRef(false);
  const lastTapRef = useRef(0);
  const lastMoveRef = useRef({ x: 0, y: 0, t: 0, vx: 0, vy: 0 });
  const coastRaf = useRef(0);
  const animateRef = useRef<() => void>(() => {});
  const zoomAtRef = useRef<(x: number, y: number, delta: number, width?: number, height?: number) => void>(
    () => {},
  );
  const zoomByRef = useRef<(delta: number) => void>(() => {});
  const resetViewRef = useRef<() => void>(() => {});
  const [finePointer, setFinePointer] = useState(false);
  const [hudLive, setHudLive] = useState(true);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onHoverRef.current = onHover;
    onFocusRef.current = onFocusPlace;
    onViewRef.current = onViewChange;
    onResetRef.current = onReset;
  }, [onSelect, onHover, onFocusPlace, onViewChange, onReset]);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const apply = () => {
      canHoverRef.current = mq.matches;
      setFinePointer(mq.matches);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const domains = useMemo(() => featuresFromCollection(atlas.geojson.domains), [atlas]);
  const fields = useMemo(() => featuresFromCollection(atlas.geojson.fields), [atlas]);
  const subfields = useMemo(() => featuresFromCollection(atlas.geojson.subfields), [atlas]);
  const needTopics = camera.zoom >= 4.1 || Boolean(enteredId);
  const topicCells = useMemo(
    () => (needTopics ? featuresFromCollection(atlas.geojson.topics) : []),
    [atlas, needTopics],
  );
  const subfieldsByField = useMemo(() => groupByField(subfields), [subfields]);
  const topicsByField = useMemo(() => groupByField(topicCells), [topicCells]);
  const uniquePins = useMemo(() => {
    const seen = new Set<string>();
    return pins.filter((pin) => {
      if (seen.has(pin.id)) return false;
      seen.add(pin.id);
      return true;
    });
  }, [pins]);

  const applyLandTransform = (next: Camera) => {
    const el = landRef.current;
    if (!el) return;
    const nextScale = pixelsPerDegree(next.zoom);
    el.setAttribute(
      "transform",
      `translate(${sizeRef.current.width / 2} ${sizeRef.current.height / 2}) scale(${nextScale}) translate(${-next.lon} ${next.lat})`,
    );
  };
  const applyLabelTransform = (next: Camera) => {
    const el = labelLayerRef.current;
    if (!el) return;
    const from = labelCamRef.current;
    const s0 = pixelsPerDegree(from.zoom);
    const s1 = pixelsPerDegree(next.zoom);
    const k = s1 / Math.max(s0, 1e-6);
    const w = sizeRef.current.width;
    const h = sizeRef.current.height;
    const tx = (1 - k) * (w / 2) - (next.lon - from.lon) * s1;
    const ty = (1 - k) * (h / 2) + (next.lat - from.lat) * s1;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${k})`;
  };
  const paintCamera = (next: Camera, commit = false) => {
    displayRef.current = next;
    applyLandTransform(next);
    if (commit) {
      labelCamRef.current = next;
      if (labelLayerRef.current) labelLayerRef.current.style.transform = "none";
      setCamera(next);
      onViewRef.current(next.lon, next.lat, next.zoom);
      return;
    }
    applyLabelTransform(next);
  };
  const freezeHud = () => {
    setHudLive(false);
  };
  const thawHud = () => {
    paintCamera(displayRef.current, true);
    setHudLive(true);
  };
  const stopCoast = () => {
    if (coastRaf.current) {
      cancelAnimationFrame(coastRaf.current);
      coastRaf.current = 0;
    }
  };
  const startCoast = () => {
    stopCoast();
    const step = () => {
      const nextVel = {
        vx: lastMoveRef.current.vx * 0.9,
        vy: lastMoveRef.current.vy * 0.9,
      };
      lastMoveRef.current.vx = nextVel.vx;
      lastMoveRef.current.vy = nextVel.vy;
      if (Math.hypot(nextVel.vx, nextVel.vy) < 0.018) {
        coastRaf.current = 0;
        thawHud();
        return;
      }
      const currentScale = pixelsPerDegree(displayRef.current.zoom);
      const next = clampCamera({
        lon: displayRef.current.lon - (nextVel.vx * 16) / currentScale,
        lat: displayRef.current.lat + (nextVel.vy * 16) / currentScale,
        zoom: displayRef.current.zoom,
      });
      targetRef.current = next;
      paintCamera(next);
      coastRaf.current = requestAnimationFrame(step);
    };
    coastRaf.current = requestAnimationFrame(step);
  };

  const animateTowardTarget = () => {
    if (rafRef.current) return;
    const step = () => {
      const display = displayRef.current;
      const target = targetRef.current;
      const zoomGap = target.zoom - display.zoom;
      const nextZoom = display.zoom + zoomGap * 0.32;
      let next: Camera = { ...display, zoom: nextZoom };

      const anchor = anchorRef.current;
      if (anchor && Math.abs(zoomGap) > 0.002) {
        const after = unproject(anchor.x, anchor.y, next, sizeRef.current.width, sizeRef.current.height);
        next = {
          ...next,
          lon: next.lon + (anchor.lon - after.lon),
          lat: next.lat + (anchor.lat - after.lat),
        };
        targetRef.current = { ...target, lon: next.lon, lat: next.lat, zoom: target.zoom };
      } else {
        next = {
          lon: display.lon + (target.lon - display.lon) * 0.28,
          lat: display.lat + (target.lat - display.lat) * 0.28,
          zoom: nextZoom,
        };
      }

      const settled =
        Math.abs(target.zoom - next.zoom) < 0.003 &&
        Math.hypot(target.lon - next.lon, target.lat - next.lat) < 0.01;
      paintCamera(settled ? target : next, settled);
      if (settled) {
        rafRef.current = 0;
        anchorRef.current = null;
        setHudLive(true);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const rect = root.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      observer.disconnect();
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  useEffect(() => {
    sizeRef.current = size;
    labelCamRef.current = displayRef.current;
    if (labelLayerRef.current) labelLayerRef.current.style.transform = "none";
  }, [size]);

  const zoomAt = (x: number, y: number, delta: number, width = sizeRef.current.width, height = sizeRef.current.height) => {
    const display = displayRef.current;
    const world = unproject(x, y, display, width, height);
    targetRef.current = clampCamera({ ...display, zoom: display.zoom + delta });
    anchorRef.current = { x, y, lon: world.lon, lat: world.lat };
    freezeHud();
    animateTowardTarget();
  };

  const zoomBy = (delta: number) => {
    zoomAt(sizeRef.current.width / 2, sizeRef.current.height / 2, delta);
  };

  const resetView = () => {
    anchorRef.current = null;
    setEnteredId(null);
    targetRef.current = INITIAL_CAMERA;
    freezeHud();
    animateTowardTarget();
    onResetRef.current?.();
  };

  useEffect(() => {
    animateRef.current = animateTowardTarget;
    zoomAtRef.current = zoomAt;
    zoomByRef.current = zoomBy;
    resetViewRef.current = resetView;
  });

  useEffect(() => {
    if (!flyTo) return;
    anchorRef.current = null;
    targetRef.current = clampCamera({ lon: flyTo.lon, lat: flyTo.lat, zoom: flyTo.zoom });
    animateRef.current();
  }, [flyTo]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      zoomAtRef.current(event.clientX - rect.left, event.clientY - rect.top, wheelDelta(event), rect.width, rect.height);
    };
    const blockTouch = (event: TouchEvent) => {
      if (event.touches.length >= 1) event.preventDefault();
    };
    const blockGesture = (event: Event) => event.preventDefault();
    root.addEventListener("wheel", onWheel, { passive: false });
    root.addEventListener("touchmove", blockTouch, { passive: false });
    root.addEventListener("gesturestart", blockGesture, { passive: false });
    return () => {
      root.removeEventListener("wheel", onWheel);
      root.removeEventListener("touchmove", blockTouch);
      root.removeEventListener("gesturestart", blockGesture);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (coastRaf.current) cancelAnimationFrame(coastRaf.current);
    };
  }, []);

  const scale = pixelsPerDegree(camera.zoom);
  const transform = `translate(${size.width / 2} ${size.height / 2}) scale(${scale}) translate(${-camera.lon} ${camera.lat})`;
  const compact = size.width < 768;
  const showSubfields = camera.zoom >= (compact ? 3.35 : 3.15);
  const showTopics = camera.zoom >= (compact ? 4.55 : 4.2);
  const showPapers = camera.zoom >= 5.8;
  const showContributors = camera.zoom >= 8.6;

  const visiblePins = useMemo(() => {
    return uniquePins.filter((pin) => {
      if (pin.emphasis) return true;
      if (pin.kind === "author") return showContributors;
      if (pin.kind === "work" || pin.era) {
        if (!showPapers) return false;
        if (pin.year != null && pin.year > year) return false;
        return true;
      }
      return camera.zoom >= 5.15;
    });
  }, [uniquePins, camera.zoom, showPapers, showContributors, year]);

  const alive = (id: string, kind: string) => isAliveInEra(id, kind, year, eraCounts);

  const selectedPlaceId =
    selectedId && atlas.places.some((place) => place.id === selectedId) ? selectedId : null;
  if (selectedPlaceId && selectedPlaceId !== enteredId) {
    setEnteredId(selectedPlaceId);
  }

  const entered = useMemo(() => {
    if (!enteredId) return null;
    return atlas.places.find((place) => place.id === enteredId) ?? null;
  }, [enteredId, atlas]);

  const eraReady = eraCounts != null;
  const eraScale = (fieldId: string | null | undefined) => fieldEraScale(fieldId, growth, eraReady);

  const paperCells = useMemo(() => {
    if (!showPapers || !entered || entered.kind !== "topic") return [];
    const parent = topicCells.find((topic) => topic.id === entered.id);
    if (!parent?.ring.length) return [];
    const works = visiblePins.filter((pin) => pin.kind === "work" && !pin.emphasis);
    if (works.length < 2) return [];
    return fillItemsInRing(works.slice(0, compact ? 18 : 36), parent.ring).map((cell) => ({
      ...cell,
      domainId: parent.domainId,
      fieldId: parent.fieldId ?? undefined,
    }));
  }, [showPapers, entered, topicCells, visiblePins, compact]);

  const pickAt = useCallback(
    (lon: number, lat: number) => {
      const ready = eraCounts != null;
      for (const field of fields) {
        const s = fieldEraScale(field.id, growth, ready);
        if (s <= 0 || !isAliveInEra(field.id, "field", year, eraCounts)) continue;
        const testLon = field.lon + (lon - field.lon) / s;
        const testLat = field.lat + (lat - field.lat) / s;
        const papersHere =
          showPapers && s >= 0.85 && paperCells.length
            ? paperCells.filter((cell) => cell.fieldId === field.id)
            : [];
        const layers = [
          papersHere.length ? (papersHere as typeof topicCells) : [],
          showTopics && s >= 0.85
            ? topicCells.filter((row) => row.fieldId === field.id && isAliveInEra(row.id, "topic", year, eraCounts))
            : [],
          showSubfields && s >= 0.62
            ? subfields.filter((row) => row.fieldId === field.id && isAliveInEra(row.id, "subfield", year, eraCounts))
            : [],
          [field],
        ].filter((layer) => layer.length > 0);
        const hit = featureAtPoint(layers, testLon, testLat);
        if (hit) return hit;
      }
      return featureAtPoint([domains], lon, lat);
    },
    [fields, growth, eraCounts, year, showPapers, paperCells, showTopics, topicCells, showSubfields, subfields, domains],
  );

  const hoverFeature = useMemo(() => {
    if (!cursor) return null;
    return pickAt(cursor.lon, cursor.lat);
  }, [cursor, pickAt]);

  const settledPins = useMemo(() => {
    if (!paperCells.length) return visiblePins;
    const byId = new Map(paperCells.map((cell) => [cell.id, cell]));
    return visiblePins.map((pin) => {
      const cell = byId.get(pin.id);
      return cell ? { ...pin, lon: cell.lon, lat: cell.lat } : pin;
    });
  }, [visiblePins, paperCells]);

  const paperUnderCursor = useMemo(() => {
    if (!hoverFeature) return null;
    return paperCells.find((cell) => cell.id === hoverFeature.id) ?? null;
  }, [hoverFeature, paperCells]);

  const sectorIndex = useMemo(() => {
    if (paperCells.length >= 2) {
      return [...paperCells]
        .sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0))
        .slice(0, 8)
        .map((cell) => ({
          id: cell.id,
          name: cell.name,
          kind: "work" as const,
          citedByCount: cell.citedByCount,
          year: cell.year,
        }));
    }
    if (entered?.kind === "subfield" && showTopics) {
      return topicCells
        .filter((topic) => topic.subfieldId === entered.id)
        .sort(
          (a, b) =>
            (eraCounts ? eraCounts[b.id] ?? 0 : b.worksCount) -
            (eraCounts ? eraCounts[a.id] ?? 0 : a.worksCount),
        )
        .slice(0, 8)
        .map((topic) => ({
          id: topic.id,
          name: topic.name,
          kind: "topic" as const,
          citedByCount: Math.round(eraCounts ? eraCounts[topic.id] ?? 0 : topic.worksCount),
          year: undefined as number | undefined,
        }));
    }
    return [];
  }, [paperCells, entered, showTopics, topicCells, eraCounts]);

  const listedPaper = paperCells.find((cell) => cell.id === listHoverId) ?? null;
  const listedTopic = topicCells.find((topic) => topic.id === listHoverId) ?? null;

  useEffect(() => {
    onFocusRef.current(entered?.id ?? null);
  }, [entered]);

  useEffect(() => {
    if (listHoverId) {
      const row =
        paperCells.find((cell) => cell.id === listHoverId) ??
        topicCells.find((topic) => topic.id === listHoverId);
      onHoverRef.current(row?.name ?? null);
      return;
    }
    onHoverRef.current(hoverFeature?.name ?? null);
  }, [hoverFeature, listHoverId, paperCells, topicCells]);

  const veil = (feature: { id: string; domainId: string; fieldId?: string | null; subfieldId?: string | null }) => {
    if (!entered || camera.zoom < 3.2) return 1;
    return isSpotlighted(feature, entered) ? 1 : 0.42;
  };

  const fieldTransform = (fieldId: string | null | undefined, lon: number, lat: number) => {
    const s = eraScale(fieldId);
    if (s >= 0.995) return undefined;
    return `translate(${lon} ${-lat}) scale(${s}) translate(${-lon} ${lat})`;
  };

  const labels = useMemo(
    () =>
      collectLabels(
        camera,
        size,
        domains,
        fields,
        subfields,
        topicCells,
        entered,
        year,
        eraCounts,
        growth,
        bottomInset,
      ),
    [camera, size, domains, fields, subfields, topicCells, entered, year, eraCounts, growth, bottomInset],
  );

  const enteredFeature = useMemo(() => {
    if (!entered) return null;
    return (
      topicCells.find((feature) => feature.id === entered.id) ??
      subfields.find((feature) => feature.id === entered.id) ??
      fields.find((feature) => feature.id === entered.id) ??
      domains.find((feature) => feature.id === entered.id) ??
      null
    );
  }, [entered, topicCells, subfields, fields, domains]);

  const enteredAnchor = enteredFeature ? fieldAnchor(enteredFeature, fields) : null;
  const hoverAnchor = hoverFeature ? fieldAnchor(hoverFeature, fields) : null;

  const pointerPoint = useMemo(() => {
    if (!cursor) return null;
    return project(cursor.lon, cursor.lat, camera, size.width, size.height);
  }, [cursor, camera, size]);

  const tipFeature = listedPaper ?? listedTopic ?? hoverFeature;
  const lockName = tipFeature?.name ?? null;
  const lockKind = tipFeature?.kind === "work" ? "paper" : (tipFeature?.kind ?? null);
  const calloutPoint =
    listHoverId && tipFeature
      ? project(tipFeature.lon, tipFeature.lat, camera, size.width, size.height)
      : pointerPoint;

  const strength = (id: string | undefined, fallback = 0.85) => {
    if (!id) return fallback;
    if (growth[id] != null) return 0.22 + 0.78 * growth[id];
    if (activity[id] != null) return activity[id];
    return fallback;
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomByRef.current(0.7);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomByRef.current(-0.7);
      } else if (event.key === "0") {
        event.preventDefault();
        resetViewRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-map-ui]")) return;
    stopCoast();
    lastMoveRef.current = { x: event.clientX, y: event.clientY, t: performance.now(), vx: 0, vy: 0 };
    if (event.pointerType !== "touch") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2) {
      dragRef.current = null;
      pinchedRef.current = true;
      freezeHud();
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const rect = event.currentTarget.getBoundingClientRect();
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const world = unproject(midX, midY, displayRef.current, rect.width, rect.height);
      pinchRef.current = {
        startDist: Math.max(dist, 1),
        startZoom: displayRef.current.zoom,
        midX,
        midY,
        lon: world.lon,
        lat: world.lat,
      };
      return;
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lon: displayRef.current.lon,
      lat: displayRef.current.lat,
      moved: false,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(event.pointerId)) {
      pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchRef.current.startDist;
      const zoom = pinchRef.current.startZoom + Math.log2(Math.max(ratio, 0.05));
      const nextZoom = clampCamera({ ...displayRef.current, zoom });
      const after = unproject(
        pinchRef.current.midX,
        pinchRef.current.midY,
        nextZoom,
        sizeRef.current.width,
        sizeRef.current.height,
      );
      const next = clampCamera({
        lon: nextZoom.lon + (pinchRef.current.lon - after.lon),
        lat: nextZoom.lat + (pinchRef.current.lat - after.lat),
        zoom: nextZoom.zoom,
      });
      targetRef.current = next;
      paintCamera(next);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (!canHoverRef.current) return;
      const target = event.target as HTMLElement;
      const name = target.dataset?.name ?? target.closest("[data-name]")?.getAttribute("data-name");
      onHoverRef.current(name ?? null);
      const now = performance.now();
      if (now - cursorTick.current > 40) {
        cursorTick.current = now;
        const rect = event.currentTarget.getBoundingClientRect();
        setCursor(
          unproject(
            event.clientX - rect.left,
            event.clientY - rect.top,
            displayRef.current,
            rect.width,
            rect.height,
          ),
        );
      }
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const slop = event.pointerType === "touch" ? 12 : 3;
    if (Math.hypot(dx, dy) > slop) {
      if (!drag.moved) freezeHud();
      drag.moved = true;
    }
    const now = performance.now();
    const dt = Math.max(8, now - lastMoveRef.current.t);
    lastMoveRef.current = {
      x: event.clientX,
      y: event.clientY,
      t: now,
      vx: (event.clientX - lastMoveRef.current.x) / dt,
      vy: (event.clientY - lastMoveRef.current.y) / dt,
    };
    const currentScale = pixelsPerDegree(displayRef.current.zoom);
    const next = clampCamera({
      lon: drag.lon - dx / currentScale,
      lat: drag.lat + dy / currentScale,
      zoom: displayRef.current.zoom,
    });
    targetRef.current = next;
    paintCamera(next);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const drag = dragRef.current;
    const pinched = pinchedRef.current;
    if (pointersRef.current.size === 0) {
      pinchedRef.current = false;
      const speed = Math.hypot(lastMoveRef.current.vx, lastMoveRef.current.vy);
      if (drag?.moved && !pinched && speed > 0.04) startCoast();
      else thawHud();
    }
    dragRef.current = null;
    if (pinched || !drag || drag.moved) return;
    const now = performance.now();
    if (!finePointer && now - lastTapRef.current < 300) {
      lastTapRef.current = 0;
      const tapRect = event.currentTarget.getBoundingClientRect();
      zoomAt(event.clientX - tapRect.left, event.clientY - tapRect.top, 0.85);
      return;
    }
    lastTapRef.current = now;
    const target = event.target as HTMLElement;
    const fromEl = target.dataset?.id ?? target.closest("[data-id]")?.getAttribute("data-id");
    if (fromEl) {
      const place = atlas.places.find((row) => row.id === fromEl);
      if (place) {
        const fieldId = place.kind === "field" ? place.id : place.fieldId;
        if (fieldId && !isAliveInEra(fieldId, "field", year, eraCounts)) return;
        setEnteredId(place.id);
      }
      onSelectRef.current(fromEl);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const world = unproject(
      event.clientX - rect.left,
      event.clientY - rect.top,
      displayRef.current,
      rect.width,
      rect.height,
    );
    if (showPapers) {
      let nearest: Pin | null = null;
      let best = 0.35;
      for (const pin of settledPins) {
        const d = Math.hypot(pin.lon - world.lon, pin.lat - world.lat);
        if (d < best) {
          best = d;
          nearest = pin;
        }
      }
      if (nearest) {
        onSelectRef.current(nearest.id);
        return;
      }
    }
    const hit = pickAt(world.lon, world.lat);
    if (hit) {
      if (atlas.places.some((row) => row.id === hit.id)) setEnteredId(hit.id);
      onSelectRef.current(hit.id);
    }
  };

  return (
    <div
      ref={rootRef}
      className="puzzle-map absolute inset-0 z-0 h-full w-full cursor-grab overflow-hidden active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        if (!canHoverRef.current) return;
        setCursor(null);
        onHoverRef.current(null);
      }}
      onDoubleClick={(event) => {
        if (!finePointer) return;
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        const rect = event.currentTarget.getBoundingClientRect();
        zoomAt(event.clientX - rect.left, event.clientY - rect.top, 0.85);
      }}
    >
      <svg
        width={size.width}
        height={size.height}
        className="absolute inset-0 block"
        role="img"
        aria-label="Map of human knowledge"
      >
        <defs>
          <radialGradient id="void-glow" cx="50%" cy="46%" r="62%">
            <stop offset="0%" stopColor="#16110c" />
            <stop offset="55%" stopColor="#0a0806" />
            <stop offset="100%" stopColor="#050403" />
          </radialGradient>
          <pattern id="hud-grid" width="56" height="56" patternUnits="userSpaceOnUse">
            <path d="M 56 0 L 0 0 0 56" fill="none" stroke="rgba(232,135,42,0.055)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#void-glow)" />
        <rect width="100%" height="100%" fill="url(#hud-grid)" />
        <g ref={landRef} transform={transform} style={{ willChange: "transform" }}>
          {fields.map((field) => {
            const sizeNow = eraScale(field.id);
            if (sizeNow <= 0 || !alive(field.id, "field")) return null;
            const paint = domainPaint(field.domainId);
            const heat = strength(field.id, 0.7);
            const kids =
              showSubfields && sizeNow >= 0.62
                ? (subfieldsByField.get(field.id) ?? []).filter((row) => alive(row.id, "subfield"))
                : [];
            const rawTopics =
              showTopics && sizeNow >= 0.85
                ? (topicsByField.get(field.id) ?? []).filter((row) => alive(row.id, "topic"))
                : [];
            const topics = cullFeatures(rawTopics, camera, size, compact ? 90 : 180, entered);
            const papers =
              showPapers && entered?.kind === "topic"
                ? paperCells.filter((cell) => cell.fieldId === field.id)
                : [];
            return (
              <g key={field.id} transform={fieldTransform(field.id, field.lon, field.lat)}>
                <path
                  data-id={field.id}
                  data-name={field.name}
                  d={field.path}
                  fill={shadeHex(featureTint(field.id, paint.fill), -28 + Math.round(heat * 42))}
                  fillOpacity={(0.4 + heat * 0.55) * veil(field)}
                  stroke={paint.coast}
                  strokeOpacity={(0.38 + heat * 0.35) * Math.max(veil(field), 0.22)}
                  strokeWidth={(camera.zoom < 3.2 ? 1.05 : 0.62) / scale}
                  style={{ cursor: "pointer" }}
                />
                {kids.map((feature) => (
                  <path
                    key={feature.id}
                    data-id={feature.id}
                    data-name={feature.name}
                    d={feature.path}
                    fill={shadeHex(featureTint(feature.id, paint.fill), -18 + Math.round(heat * 34))}
                    fillOpacity={(0.44 + heat * 0.5) * veil(feature)}
                    stroke="#e8c090"
                    strokeOpacity={0.45 * Math.max(veil(feature), 0.22)}
                    strokeWidth={0.7 / scale}
                    style={{ cursor: "pointer" }}
                  />
                ))}
                {topics.map((feature) => (
                  <path
                    key={feature.id}
                    data-id={feature.id}
                    data-name={feature.name}
                    d={feature.path}
                    fill={shadeHex(featureTint(feature.id, paint.fill), -14 + Math.round(heat * 30))}
                    fillOpacity={(0.52 + heat * 0.4) * veil(feature)}
                    stroke="#f0d2a8"
                    strokeOpacity={0.42 * Math.max(veil(feature), 0.2)}
                    strokeWidth={0.55 / scale}
                    style={{ cursor: "pointer" }}
                  />
                ))}
                {papers.map((cell) => (
                  <path
                    key={`paper-cell-${cell.id}`}
                    data-id={cell.id}
                    data-name={cell.name}
                    d={cell.path}
                    fill={shadeHex(featureTint(cell.id, paint.fill), 8)}
                    fillOpacity={listHoverId && cell.id !== listHoverId ? 0.28 : 0.78}
                    stroke="#f0d2a8"
                    strokeOpacity={0.38}
                    strokeWidth={0.45 / scale}
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </g>
            );
          })}
          {enteredFeature && enteredAnchor && enteredFeature.id !== hoverFeature?.id && (
            <g
              pointerEvents="none"
              transform={fieldTransform(enteredAnchor.fieldId, enteredAnchor.lon, enteredAnchor.lat)}
            >
              <path
                d={enteredFeature.path}
                fill="none"
                stroke="#e8872a"
                strokeOpacity={0.45}
                strokeLinejoin="round"
                strokeWidth={1.6 / scale}
              />
            </g>
          )}
          {finePointer && hoverFeature && hoverAnchor && (
            <g
              className="hud-trace"
              pointerEvents="none"
              transform={fieldTransform(hoverAnchor.fieldId, hoverAnchor.lon, hoverAnchor.lat)}
            >
              <path
                d={hoverFeature.path}
                fill={domainPaint(hoverFeature.domainId ?? "domain:3").fill}
                fillOpacity={0.08}
                stroke="none"
              />
              <path
                d={hoverFeature.path}
                fill="none"
                stroke="#ffc078"
                strokeOpacity={0.95}
                strokeLinejoin="round"
                strokeLinecap="round"
                strokeWidth={2.2 / scale}
              />
            </g>
          )}
          {settledPins.map((pin) => {
            if (pin.kind === "work" && !pin.emphasis) return null;
            const home = pin.placeId ? atlas.places.find((place) => place.id === pin.placeId) : null;
            const fieldId = home?.kind === "field" ? home.id : home?.fieldId;
            const field = fieldId ? fields.find((row) => row.id === fieldId) : null;
            const r = (pin.emphasis ? 5.4 : pin.era ? 2.4 : 2.6) / scale;
            return (
              <g key={`pin-${pin.id}`} transform={field ? fieldTransform(field.id, field.lon, field.lat) : undefined}>
                <circle
                  data-id={pin.id}
                  data-name={pin.name}
                  cx={pin.lon}
                  cy={-pin.lat}
                  r={r}
                  fill={pinColor(pin.kind)}
                  stroke="#050403"
                  strokeWidth={1.1 / scale}
                  style={{ cursor: "pointer" }}
                />
                {selectedId === pin.id && (
                  <circle
                    cx={pin.lon}
                    cy={-pin.lat}
                    r={r * 2.2}
                    fill="none"
                    stroke="#ffc078"
                    strokeWidth={1.4 / scale}
                  />
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {playing && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-[46%] font-[family-name:var(--font-display)] text-[22vw] leading-none tracking-[0.08em] text-white/[0.05]">
          {Math.round(year)}
        </div>
      )}

      {sectorIndex.length > 0 && !compact && (
        <div
          className="pointer-events-auto absolute top-28 left-4 z-20 w-[min(18rem,calc(100%-6rem))] sm:left-6"
          data-map-ui="index"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerLeave={() => setListHoverId(null)}
        >
          <div className="hud-panel panel-in">
            <div className="hud-panel-feet pointer-events-none absolute inset-0" />
            <div className="border-b border-[var(--line)] px-3 py-2">
              <p className="truncate text-[13px] tracking-wide text-[var(--ink)]">
                {cleanText(entered?.name ?? "This region")}
              </p>
            </div>
            <ol className="max-h-[min(18rem,42vh)] overflow-auto py-1 scrollbar-thin">
              {sectorIndex.map((row, index) => (
                <li key={row.id}>
                  <button
                    type="button"
                    data-map-ui="index"
                    onMouseEnter={() => setListHoverId(row.id)}
                    onFocus={() => setListHoverId(row.id)}
                    onClick={() => onSelect(row.id)}
                    className={`dossier-row flex w-full items-start gap-2 px-3 py-1.5 text-left ${
                      listHoverId === row.id || paperUnderCursor?.id === row.id ? "bg-[rgba(232,135,42,0.1)]" : ""
                    }`}
                  >
                    <span className="w-4 shrink-0 font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--signal)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] leading-snug">{cleanText(row.name)}</span>
                      <span className="block font-[family-name:var(--font-geist-mono)] text-[10px] text-[var(--muted)]">
                        {row.year ? `${row.year} · ` : ""}
                        {row.citedByCount != null ? `${compactNumber(row.citedByCount)} ${row.kind === "work" ? "cites" : "works"}` : ""}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

          </div>
        </div>
      )}

      <div className="pointer-events-none absolute top-[max(6.75rem,calc(env(safe-area-inset-top)+5.75rem))] right-[max(0.75rem,env(safe-area-inset-right))] z-20 md:top-auto md:bottom-[max(7rem,calc(var(--chrome-bottom,7rem)))] md:left-6 md:right-auto">
        <div className="hud-panel hud-zoom pointer-events-auto flex flex-col">
          <div className="hud-panel-feet pointer-events-none absolute inset-0" />
          <button
            type="button"
            data-map-ui="zoom"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => zoomBy(0.7)}
            className="flex h-10 w-10 items-center justify-center text-lg"
            aria-label="Zoom in"
          >
            +
          </button>
          <div className="h-px bg-[var(--line)]" />
          <button
            type="button"
            data-map-ui="zoom"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => zoomBy(-0.7)}
            className="flex h-10 w-10 items-center justify-center text-lg"
            aria-label="Zoom out"
          >
            −
          </button>
          <div className="h-px bg-[var(--line)]" />
          <button
            type="button"
            data-map-ui="zoom"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={resetView}
            className="flex h-10 w-10 items-center justify-center text-[var(--muted)] hover:text-[var(--signal-hot)]"
            aria-label="Reset to overview"
            title="Overview"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
              <path d="M12 4.2 4.5 10.2V20a.8.8 0 0 0 .8.8h4.4v-5.4h4.6V20.8h4.4a.8.8 0 0 0 .8-.8v-9.8L12 4.2Z" />
            </svg>
          </button>
        </div>
      </div>

      <div
        ref={labelLayerRef}
        className="pointer-events-none absolute inset-0 z-10 origin-top-left"
        style={{ willChange: "transform" }}
      >
        {labels.map((label) => (
            <button
              key={`label-${label.id}`}
              type="button"
              data-map-ui="label"
              data-id={label.id}
              data-name={label.name}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(label.id);
              }}
              className={`hud-place pointer-events-auto hud-place--${label.kind}`}
              style={{
                left: label.x,
                top: label.y,
                fontSize: label.kind === "domain" ? 12 : label.kind === "field" ? 11 : 10,
              }}
            >
              {cleanText(label.name)}
            </button>
          ))}
        {hudLive &&
          lockName &&
          (finePointer || listHoverId) &&
          calloutPoint &&
          calloutPoint.x > 24 &&
          calloutPoint.x < size.width - 24 &&
          calloutPoint.y > 72 &&
          calloutPoint.y < size.height - 80 && (
          <div
            className="hud-callout hud-callout--cursor hud-corners"
            style={{ left: calloutPoint.x, top: calloutPoint.y }}
          >
            <i aria-hidden className="pointer-events-none absolute inset-0" />
            <span className="hud-callout__kind">{lockKind}</span>
            <span className="hud-callout__name">{cleanText(shortenTitle(lockName))}</span>
            {listedPaper && listedPaper.citedByCount != null && (
              <span className="hud-callout__meta">{compactNumber(listedPaper.citedByCount)} cites</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function collectLabels(
  camera: Camera,
  size: { width: number; height: number },
  domains: ReturnType<typeof featuresFromCollection>,
  fields: ReturnType<typeof featuresFromCollection>,
  subfields: ReturnType<typeof featuresFromCollection>,
  topics: ReturnType<typeof featuresFromCollection>,
  focus: { id: string; kind: string; parentId: string | null; subfieldId?: string; fieldId?: string } | null,
  year: number,
  eraCounts: Record<string, number> | null,
  growth: Record<string, number>,
  bottomInset = 0,
): Label[] {
  const mobile = size.width < 768;
  const padTop = mobile ? 70 : 88;
  const padSide = mobile ? 8 : 48;
  const padBottom = mobile ? Math.max(bottomInset + 18, 84) : 120;
  const eraReady = eraCounts != null;
  const byField = new Map(fields.map((field) => [field.id, field]));

  const placePoint = (item: {
    id: string;
    kind: string;
    lon: number;
    lat: number;
    fieldId?: string | null;
  }) => {
    const fieldId = item.kind === "field" ? item.id : item.fieldId;
    const scale = fieldEraScale(fieldId, growth, eraReady);
    if (item.kind !== "domain" && scale <= 0) return null;
    if (item.kind === "field" || item.kind === "domain" || !fieldId) {
      return { lon: item.lon, lat: item.lat, scale };
    }
    const home = byField.get(fieldId);
    if (!home) return { lon: item.lon, lat: item.lat, scale };
    return {
      lon: home.lon + (item.lon - home.lon) * scale,
      lat: home.lat + (item.lat - home.lat) * scale,
      scale,
    };
  };

  type Candidate = {
    id: string;
    name: string;
    kind: string;
    lon: number;
    lat: number;
    worksCount?: number;
  };
  let candidates: Candidate[] = [];
  const living = (id: string, kind: string) => isAliveInEra(id, kind, year, eraCounts);
  const fieldScale = (fieldId: string | null | undefined) => fieldEraScale(fieldId, growth, eraReady);

  if (camera.zoom < 2.3) {
    candidates = domains.map((item) => ({ ...item, kind: "domain" }));
  } else {
    for (const field of fields) {
      const scale = fieldScale(field.id);
      if (scale <= 0 || !living(field.id, "field")) continue;

      const childrenReady = camera.zoom >= 3.25 && scale >= 0.62;
      const topicsReady = camera.zoom >= 4.35 && scale >= 0.85;

      if (!childrenReady) {
        candidates.push({ ...field, kind: "field" });
        continue;
      }

      const kids = subfields.filter((item) => item.fieldId === field.id && living(item.id, "subfield"));
      if (!topicsReady) {
        candidates.push(...kids.map((item) => ({ ...item, kind: "subfield" })));
        continue;
      }

      if (focus?.kind === "subfield" && focus.id && focus.fieldId === field.id) {
        candidates.push(
          ...topics
            .filter((item) => item.subfieldId === focus.id && living(item.id, "topic"))
            .map((item) => ({ ...item, kind: "topic" })),
        );
        candidates.push(
          ...kids.filter((item) => item.id !== focus.id).map((item) => ({ ...item, kind: "subfield" })),
        );
      } else if (focus?.kind === "field" && focus.id === field.id) {
        candidates.push(...kids.map((item) => ({ ...item, kind: "subfield" })));
      } else {
        candidates.push(...kids.map((item) => ({ ...item, kind: "subfield" })));
      }
    }
  }

  candidates.sort((a, b) => (b.worksCount ?? 0) - (a.worksCount ?? 0));

  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const labels: Label[] = [];
  const limit = mobile ? 22 : 24;
  const charW = mobile ? 5.2 : 6.6;
  const maxW = mobile ? 132 : 168;

  for (const item of candidates) {
    const placedAt = placePoint(item);
    if (!placedAt) continue;
    const point = project(placedAt.lon, placedAt.lat, camera, size.width, size.height);
    if (
      point.x < padSide ||
      point.y < padTop ||
      point.x > size.width - padSide ||
      point.y > size.height - padBottom
    ) {
      continue;
    }
    const width = Math.min(item.name.length * charW + 12, maxW);
    const box = { x: point.x - width / 2, y: point.y - 10, w: width, h: mobile ? 18 : 22 };
    if (placed.some((other) => overlaps(other, box))) continue;
    placed.push(box);
    labels.push({
      id: item.id,
      name: cleanText(item.name),
      kind: item.kind,
      x: point.x,
      y: point.y,
    });
    if (labels.length >= limit) break;
  }
  return labels;
}

function isSpotlighted(
  feature: { id: string; domainId: string; fieldId?: string | null; subfieldId?: string | null },
  focus: { id: string; kind: string; parentId: string | null; fieldId?: string; subfieldId?: string; domainId?: string },
): boolean {
  if (feature.id === focus.id) return true;
  if (feature.id === focus.parentId || feature.id === focus.fieldId || feature.id === focus.subfieldId) return true;
  if (focus.kind === "field" && feature.fieldId === focus.id) return true;
  if (focus.kind === "subfield" && (feature.subfieldId === focus.id || feature.id === focus.id)) return true;
  if (focus.kind === "topic" && (feature.subfieldId === focus.parentId || feature.id === focus.parentId)) return true;
  if (focus.kind === "domain" && feature.domainId === focus.id) return true;
  return false;
}

function shortenTitle(name: string): string {
  const clean = cleanText(name);
  return clean.length > 42 ? `${clean.slice(0, 40).trim()}…` : clean;
}

function wheelDelta(event: WheelEvent): number {
  let dy = event.deltaY;
  if (event.deltaMode === 1) dy *= 16;
  if (event.deltaMode === 2) dy *= 400;
  const unit = event.ctrlKey || event.metaKey ? 0.014 : 0.0045;
  const stepped = Math.abs(dy) * unit;
  return -Math.sign(dy) * Math.min(0.55, Math.max(0.14, stepped));
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function fieldAnchor(
  feature: { id: string; fieldId?: string | null; lon: number; lat: number },
  fields: ReturnType<typeof featuresFromCollection>,
) {
  const fieldId = feature.id.startsWith("field:") ? feature.id : (feature.fieldId ?? null);
  const home = fieldId ? fields.find((row) => row.id === fieldId) : undefined;
  return {
    fieldId,
    lon: home?.lon ?? feature.lon,
    lat: home?.lat ?? feature.lat,
  };
}

function groupByField(items: ReturnType<typeof featuresFromCollection>) {
  const map = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.fieldId ?? "";
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function cullFeatures(
  items: ReturnType<typeof featuresFromCollection>,
  camera: Camera,
  size: { width: number; height: number },
  cap: number,
  focus: { id: string } | null,
) {
  if (items.length <= cap) return items;
  const pad = 80;
  const visible = items.filter((item) => {
    if (focus && item.id === focus.id) return true;
    const point = project(item.lon, item.lat, camera, size.width, size.height);
    return point.x > -pad && point.y > -pad && point.x < size.width + pad && point.y < size.height + pad;
  });
  if (visible.length <= cap) return visible;
  return [...visible].sort((a, b) => b.worksCount - a.worksCount).slice(0, cap);
}

function pinColor(kind: string): string {
  switch (kind) {
    case "author":
      return "#e8d5a3";
    case "institution":
      return "#d4b8e8";
    case "source":
      return "#b8d4c8";
    case "work":
      return "#c5d5e8";
    default:
      return "#f4e4c1";
  }
}
