// components/PatternSearchPanel.tsx
//
// Manual "find" tool for the loaded buffer, separate from automatic
// carving. Collapsed by default so it doesn't compete visually with the
// primary Drop → Telemetry → Reconstruction flow — opens on demand.

'use client';

import { useState } from 'react';

export type SearchFormat = 'hex' | 'ascii' | 'decimal';

export interface SearchHit {
  offset: number;
  contextHex: string;
}

interface PatternSearchPanelProps {
  disabled: boolean;
  onSearch: (query: string, format: SearchFormat) => void;
  hits: SearchHit[];
  totalMatches: number | null;
  error: string | null;
  isSearching: boolean;
  onSelectOffset?: (offset: number) => void;
}

const FORMAT_PLACEHOLDERS: Record<SearchFormat, string> = {
  hex: 'FF D8 FF or ffd8ff',
  ascii: 'JFIF',
  decimal: '255 216 255',
};

const FORMAT_LABELS: Record<SearchFormat, string> = {
  hex: 'Hex',
  ascii: 'ASCII',
  decimal: 'Decimal',
};

export function PatternSearchPanel({ disabled, onSearch, hits, totalMatches, error, isSearching, onSelectOffset }: PatternSearchPanelProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<SearchFormat>('hex');
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || disabled) return;
    onSearch(query, format);
  };

  return (
    <div className="rounded-rb border border-rb-hairline bg-rb-panel overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-rb-panel-raised transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-rb-text">Manual Signature Search</span>
          <span className="text-xs text-rb-faint font-mono">hex · ascii · decimal</span>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`text-rb-faint transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-rb-hairline px-5 py-4 flex flex-col gap-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <div className="flex gap-1.5" role="radiogroup" aria-label="Search pattern format">
              {(['hex', 'ascii', 'decimal'] as SearchFormat[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => setFormat(f)}
                  className={`rounded-rb px-3 py-1 text-xs font-mono uppercase tracking-wide border transition-colors ${
                    format === f
                      ? 'bg-rb-amber-dim border-rb-amber/40 text-rb-amber'
                      : 'bg-rb-bg border-rb-hairline text-rb-muted hover:border-rb-faint'
                  }`}
                >
                  {FORMAT_LABELS[f]}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={FORMAT_PLACEHOLDERS[format]}
                disabled={disabled}
                className="flex-1 rounded-rb border border-rb-hairline bg-rb-bg px-3 py-2 text-sm font-mono text-rb-text placeholder:text-rb-faint disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={disabled || !query.trim()}
                className="rounded-rb bg-rb-amber px-4 py-2 text-sm font-medium text-rb-bg hover:brightness-110 transition disabled:opacity-40 disabled:hover:brightness-100"
              >
                {isSearching ? 'Searching…' : 'Search'}
              </button>
            </div>

            {disabled && <p className="text-xs text-rb-faint">Load a file above before searching.</p>}
          </form>

          {error && (
            <div role="alert" className="rounded-rb border border-rb-red/30 bg-rb-red-dim px-3 py-2 text-sm text-rb-red">
              {error}
            </div>
          )}

          {!error && totalMatches !== null && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-rb-muted font-mono">
                {totalMatches === 0
                  ? 'No matches found.'
                  : `${totalMatches.toLocaleString()} match${totalMatches === 1 ? '' : 'es'}${
                      totalMatches > hits.length ? ` (showing first ${hits.length.toLocaleString()})` : ''
                    }`}
              </p>

              {hits.length > 0 && (
                <div className="max-h-60 overflow-auto rounded-rb border border-rb-hairline">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-rb-hairline text-rb-faint uppercase tracking-wide">
                        <th className="px-3 py-2 font-medium">Offset</th>
                        <th className="px-3 py-2 font-medium">Context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hits.map((h) => (
                        <tr
                          key={h.offset}
                          onClick={() => onSelectOffset?.(h.offset)}
                          className={`border-b border-rb-hairline last:border-0 font-mono ${
                            onSelectOffset ? 'cursor-pointer hover:bg-rb-panel-raised' : ''
                          }`}
                        >
                          <td className="px-3 py-1.5 text-rb-amber whitespace-nowrap">0x{h.offset.toString(16).toUpperCase()}</td>
                          <td className="px-3 py-1.5 text-rb-muted whitespace-nowrap">{h.contextHex}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
