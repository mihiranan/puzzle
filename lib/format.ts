export function compactNumber(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(n);
}

export function kindLabel(kind: string): string {
  switch (kind) {
    case "domain":
      return "Domain";
    case "field":
      return "Field";
    case "subfield":
      return "Subfield";
    case "topic":
      return "Topic";
    case "work":
      return "Paper";
    case "author":
      return "Researcher";
    case "institution":
      return "Institution";
    case "source":
      return "Journal";
    case "keyword":
      return "Keyword";
    default:
      return kind;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function cleanText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Professional sentence casing for blurbs that arrive lowercase from OpenAlex. */
export function polishCopy(value: string | null | undefined): string {
  const text = cleanText(value);
  if (!text) return "";
  return text.replace(/(^|[.!?]\s+)(\p{Ll})/gu, (_, pre: string, letter: string) => pre + letter.toUpperCase());
}
