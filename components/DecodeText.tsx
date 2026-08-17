"use client";

import { useEffect, useState } from "react";

const GLYPHS = "0123456789ABCDEF#$%*<>/\\|+=?";

type Props = {
  text: string;
  className?: string;
  as?: "span" | "p" | "h2";
  duration?: number;
};

export default function DecodeText({ text, className, as: Tag = "span", duration = 640 }: Props) {
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (!text) {
      setShown("");
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const reveal = Math.floor(t * text.length);
      let next = "";
      for (let i = 0; i < text.length; i++) {
        if (text[i] === " ") {
          next += " ";
          continue;
        }
        next += i < reveal ? text[i] : GLYPHS[(i * 17 + Math.floor(now / 40)) % GLYPHS.length];
      }
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
      else setShown(text);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text, duration]);

  return <Tag className={className}>{shown}</Tag>;
}

export function HexStream({ seed }: { seed: string }) {
  const block = hashBlock(seed);
  return (
    <div className="hex-ticker" aria-hidden>
      <span>
        {block}
        <br />
        {hashBlock(`${seed}:b`)}
      </span>
    </div>
  );
}

function hashBlock(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const chunks = [];
  for (let i = 0; i < 6; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    chunks.push((h >>> 0).toString(16).padStart(8, "0").toUpperCase());
  }
  return chunks.join(" ");
}
