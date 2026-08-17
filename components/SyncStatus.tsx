"use client";

import { useEffect, useState } from "react";

type Props = {
  atlasRefreshing?: boolean;
  entityLoading?: boolean;
  eraLoading?: boolean;
  papersLoading?: boolean;
  compact?: boolean;
};

function useHeldFlag(active: boolean, showAfter = 120, holdFor = 280) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (active) {
      const start = window.setTimeout(() => setShown(true), showAfter);
      return () => window.clearTimeout(start);
    }
    const hide = window.setTimeout(() => setShown(false), holdFor);
    return () => window.clearTimeout(hide);
  }, [active, showAfter, holdFor]);

  return shown;
}

export default function SyncStatus({
  atlasRefreshing = false,
  entityLoading = false,
  eraLoading = false,
  papersLoading = false,
  compact = false,
}: Props) {
  const busy = atlasRefreshing || entityLoading || eraLoading || papersLoading;
  const visible = useHeldFlag(busy);
  const label = atlasRefreshing
    ? "Updating pieces"
    : entityLoading
      ? "Opening file"
      : eraLoading
        ? "Reading this year"
        : papersLoading
          ? "Placing papers"
          : null;

  if (!visible || !label) return null;

  if (compact) {
    return <span className="sync-spinner" role="status" aria-label={label} />;
  }

  return (
    <div
      className="pointer-events-none flex items-center gap-2 whitespace-nowrap"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sync-spinner" aria-hidden />
      <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.16em] text-[var(--signal)] uppercase">
        {label}
      </span>
    </div>
  );
}
