"use client";

type Props = {
  year: number;
  playing: boolean;
  loading?: boolean;
  headline?: string | null;
  hottestField?: string | null;
  min?: number;
  max?: number;
  onYear: (year: number) => void;
  onPlaying: (playing: boolean) => void;
};

export default function Timeline({
  year,
  playing,
  min = 1950,
  max = 2026,
  onYear,
  onPlaying,
}: Props) {
  return (
    <div className="hud-bar pointer-events-auto flex w-full items-center gap-3 px-3 py-2 md:py-2.5">
      <button
        type="button"
        onClick={() => onPlaying(!playing)}
        className="flex h-11 w-11 shrink-0 items-center justify-center border border-[var(--line)] text-[11px] text-[var(--signal)] hover:bg-[rgba(232,135,42,0.1)] hover:text-[var(--signal-hot)] md:h-7 md:w-7"
        aria-label={playing ? "Pause time" : "Play time"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        value={year}
        onChange={(event) => onYear(Number(event.target.value))}
        className="year-range min-w-0 flex-1"
        aria-label="Year"
      />
      <span className="year-readout w-12 shrink-0 text-right font-[family-name:var(--font-display)] text-lg leading-none tracking-[0.06em]">
        {year}
      </span>
    </div>
  );
}
