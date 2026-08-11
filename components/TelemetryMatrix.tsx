// components/TelemetryMatrix.tsx
//
// The real-time inspection table. One row per detected payload — whether
// carved directly from the buffer or decoded out of a Base64 block found
// in extracted text. Selecting a row drives the Reconstruction Canvas.

'use client';

import { ByteRuler } from './ByteRuler';
import { EntropyBadge, SignatureBadge, FooterStatusBadge } from './StatusBadges';
import type { RenderMode } from '../lib/hooks/useRawblobWorker';

export interface TelemetryRow {
  id: string;
  origin: string; // e.g. "Buffer offset 0x0184" or "Base64 block, line text"
  type: string;
  signatureName: string;
  weakSignature: boolean;
  entropyScore: number;
  entropyConfidence: 'low' | 'medium' | 'high';
  entropyConsistent: boolean;
  byteLength: number;
  startOffset: number;
  endOffset: number;
  renderMode: RenderMode;
  footerFound: boolean;
  hasStandardFooter: boolean;
}

interface TelemetryMatrixProps {
  rows: TelemetryRow[];
  totalBytes: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function highlightColorFor(row: TelemetryRow): 'amber' | 'teal' | 'red' {
  if (row.entropyScore >= 7.2 && !row.weakSignature) return 'red';
  if (!row.entropyConsistent) return 'red';
  return row.weakSignature ? 'amber' : 'teal';
}

export function TelemetryMatrix({ rows, totalBytes, selectedId, onSelect }: TelemetryMatrixProps) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-rb border border-rb-hairline bg-rb-panel px-6 py-16 text-center">
        <p className="text-rb-muted">No payloads detected yet.</p>
        <p className="text-sm text-rb-faint max-w-sm">
          Drop a file above to scan its byte stream for embedded files and encoded payloads.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-rb border border-rb-hairline bg-rb-panel overflow-hidden">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-rb-hairline text-xs uppercase tracking-wide text-rb-faint">
            <th className="px-4 py-3 font-medium">Source</th>
            <th className="px-4 py-3 font-medium">Signature</th>
            <th className="px-4 py-3 font-medium">Entropy</th>
            <th className="px-4 py-3 font-medium">Size</th>
            <th className="px-4 py-3 font-medium">Position</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row.id)}
                tabIndex={0}
                role="button"
                aria-selected={selected}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(row.id)}
                className={`cursor-pointer border-b border-rb-hairline last:border-0 transition-colors ${
                  selected ? 'bg-rb-amber-dim' : 'hover:bg-rb-panel-raised'
                }`}
              >
                <td className="px-4 py-3 font-mono text-xs text-rb-muted whitespace-nowrap">{row.origin}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <SignatureBadge name={row.signatureName} weak={row.weakSignature} />
                    <FooterStatusBadge footerFound={row.footerFound} hasStandardFooter={row.hasStandardFooter} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <EntropyBadge score={row.entropyScore} confidence={row.entropyConfidence} consistent={row.entropyConsistent} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-rb-muted whitespace-nowrap">{formatBytes(row.byteLength)}</td>
                <td className="px-4 py-3">
                  <ByteRuler
                    mode="mini"
                    totalBytes={totalBytes}
                    highlightStart={row.startOffset}
                    highlightEnd={row.endOffset}
                    highlightColor={highlightColorFor(row)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
