"use client";

import { useEffect, useState } from "react";

export function isNarrowView(width = defaultWidth()): boolean {
  return width < 768;
}

export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return narrow;
}

export function useViewHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window !== "undefined" ? Math.round(window.visualViewport?.height ?? window.innerHeight) : 800,
  );
  useEffect(() => {
    const measure = () => {
      setHeight(Math.round(window.visualViewport?.height ?? window.innerHeight));
    };
    measure();
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);
  return height;
}

export function defaultWidth(): number {
  return typeof window === "undefined" ? 1200 : window.innerWidth;
}

export function defaultHeight(): number {
  return typeof window === "undefined" ? 800 : window.innerHeight;
}

export function usableMapView(
  width = defaultWidth(),
  height = defaultHeight(),
  inspectorOpen = false,
  sheetExpanded = false,
): { width: number; height: number } {
  const mobile = isNarrowView(width);
  if (mobile) {
    const dock = 64;
    const sheet = inspectorOpen ? height * (sheetExpanded ? 0.7 : 0.4) : 0;
    return {
      width: Math.max(200, width - 24),
      height: Math.max(160, height - dock - sheet - 92),
    };
  }
  return {
    width: Math.max(280, Math.min(760, width - (inspectorOpen ? 460 : 72))),
    height: Math.max(240, Math.min(680, height - 150)),
  };
}
