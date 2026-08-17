"use client";

import { useEffect, useRef } from "react";
import { cleanText, kindLabel } from "@/lib/format";
import type { SearchHit } from "@/lib/types";

type Props = {
  query: string;
  onQuery: (value: string) => void;
  results: SearchHit[];
  open: boolean;
  onOpen: (open: boolean) => void;
  activeIndex: number;
  onActiveIndex: (index: number) => void;
  onChoose: (hit: SearchHit) => void;
  loading: boolean;
};

export default function SearchOmnibox({
  query,
  onQuery,
  results,
  open,
  onOpen,
  activeIndex,
  onActiveIndex,
  onChoose,
  loading,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) inputRef.current?.blur();
  }, [open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if ((meta && event.key.toLowerCase() === "k") || event.key === "/") {
        if (event.key === "/" && event.target instanceof HTMLInputElement) return;
        event.preventDefault();
        onOpen(true);
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpen]);

  const closeSearch = () => {
    onOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div
      className="pointer-events-auto relative z-30 w-full"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {open && (
        <button
          type="button"
          aria-label="Dismiss search"
          className="fixed inset-0 z-10 bg-black/35 md:hidden"
          onPointerDown={(event) => {
            event.preventDefault();
            closeSearch();
          }}
        />
      )}
      <div className="hud-bar relative z-20 flex w-full items-center gap-2 overflow-hidden px-3 py-2.5 md:px-4">
        {loading && <span className="sync-spinner shrink-0" aria-hidden />}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
            onOpen(true);
            onActiveIndex(0);
          }}
          onFocus={() => onOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onActiveIndex(Math.min(activeIndex + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onActiveIndex(Math.max(activeIndex - 1, 0));
            } else if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault();
              inputRef.current?.blur();
              onChoose(results[activeIndex]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              closeSearch();
            }
          }}
          placeholder="Field, person, paper, or university"
          inputMode="search"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          autoComplete="off"
          className="search-field select-text bg-transparent font-[family-name:var(--font-geist-mono)] leading-6 text-[var(--ink)] outline-none placeholder:text-[var(--muted)]"
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--muted)] hover:text-[var(--signal-hot)]"
            onClick={() => {
              onQuery("");
              onActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <div className="hud-panel absolute inset-x-0 top-[calc(100%+8px)] z-20 overflow-hidden">
          <div className="hud-panel-feet pointer-events-none absolute inset-0" />
          {query.trim().length < 2 && results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--muted)]">
              Try Hinton, Stanford, computer vision, or Attention is all you need.
            </div>
          ) : loading && results.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-[var(--muted)]">
              <span className="sync-spinner" aria-hidden />
              Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-xs text-[var(--muted)]">
              Nothing found. Try a field, a person, a university, or a paper title.
            </div>
          ) : (
            <ul className="max-h-[min(24rem,38dvh)] overflow-auto overscroll-contain py-1 scrollbar-thin">
              {results.map((hit, index) => (
                <li key={`${hit.id}-${index}`}>
                  <button
                    type="button"
                    onMouseEnter={() => onActiveIndex(index)}
                    onClick={() => {
                      inputRef.current?.blur();
                      onChoose(hit);
                    }}
                    className={`flex min-h-12 w-full items-start justify-between gap-3 px-4 py-3 text-left md:min-h-0 md:py-2.5 ${
                      index === activeIndex ? "bg-[rgba(232,135,42,0.1)]" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[15px] leading-snug md:text-sm">{cleanText(hit.name)}</span>
                      {hit.hint && (
                        <span className="mt-0.5 block font-[family-name:var(--font-geist-mono)] text-[11px] text-[var(--muted)]">
                          {cleanText(hit.hint)}
                        </span>
                      )}
                    </span>
                    <span className="kind-pill shrink-0">{kindLabel(hit.kind)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
