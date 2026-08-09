// components/ByteRuler.tsx
//
// The signature visual element of Rawblob's UI. A tick-marked strip that
// represents the full byte range of the analyzed buffer. Two modes:
//   - "full": the wide ruler shown above the Reconstruction Canvas, with
//     hex offset labels and a highlighted band for the selected file.
//   - "mini": a compact position-bar shown per row in the Telemetry Matrix,
//     showing at a glance where that carved file sits within the whole blob.
// This isn't decoration — offset position is the one piece of context that
// every other panel in the dashboard implicitly depends on, so it's made
// visible everywhere rather than left in a table column.

import { useMemo } from 'react';

interface ByteRulerProps {
  totalBytes: number;
  mode: 'full' | 'mini';
  highlightStart?: number;
  highlightEnd?: number;
  highlightColor?: 'amber' | 'teal' | 'red';
}

const HIGHLIGHT_CLASS: Record<string, string> = {
  amber: 'bg-rb-amber',
  teal: 'bg-rb-teal',
  red: 'bg-rb-red',
};

function toHexOffset(n: number): string {
  return '0x' + n.toString(16).toUpperCase().padStart(4, '0');
}

export function ByteRuler({
  totalBytes,
  mode,
  highlightStart = 0,
  highlightEnd = 0,
  highlightColor = 'amber',
}: ByteRulerProps) {
  const safeTotal = Math.max(totalBytes, 1);
  const startPct = (highlightStart / safeTotal) * 100;
  const widthPct = Math.max(((highlightEnd - highlightStart) / safeTotal) * 100, mode === 'mini' ? 0.6 : 0.2);

  const ticks = useMemo(() => {
    if (mode === 'mini') return [];
    const tickCount = 8;
    return Array.from({ length: tickCount + 1 }, (_, i) => {
      const offset = Math.round((safeTotal / tickCount) * i);
      return { offset, pct: (offset / safeTotal) * 100 };
    });
  }, [safeTotal, mode]);

  if (mode === 'mini') {
    return (
      <div className="relative h-1.5 w-24 rounded-full bg-rb-hairline overflow-hidden" aria-hidden="true">
        <div
          className={`absolute top-0 h-full rounded-full ${HIGHLIGHT_CLASS[highlightColor]}`}
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
        />
      </div>
    );
  }

  return (
    <div className="w-full select-none">
      <div className="relative h-6 border-b border-rb-hairline">
        {ticks.map((t) => (
          <div key={t.offset} className="absolute top-0 h-full flex flex-col items-start" style={{ left: `${t.pct}%` }}>
            <div className="w-px h-2 bg-rb-faint" />
            <span className="mt-0.5 text-[10px] font-mono text-rb-faint -translate-x-1/2">{toHexOffset(t.offset)}</span>
          </div>
        ))}
      </div>
      <div className="relative h-2 mt-1 rounded-full bg-rb-panel-raised overflow-hidden">
        <div
          className={`absolute top-0 h-full rounded-full ${HIGHLIGHT_CLASS[highlightColor]} transition-all duration-200`}
          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
        />
      </div>
    </div>
  );
}
