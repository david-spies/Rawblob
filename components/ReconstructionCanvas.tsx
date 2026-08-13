// components/ReconstructionCanvas.tsx
//
// Split-screen inspector for the selected payload. Rendering strictly
// follows the renderMode assigned in useRawblobWorker:
//   - image     -> <img> from the tracked Object URL
//   - text      -> rendered as escaped text content, never innerHTML
//   - sandboxed -> <iframe sandbox=""> with no allow-scripts (SVG/HTML)
//   - inert     -> never rendered live; hex dump + guarded download only
// This is the component most exposed to attacker-controlled bytes, so it
// never takes a shortcut around the mode a payload was classified into.

'use client';

import { useMemo } from 'react';
import { ByteRuler } from './ByteRuler';
import { RenderModeBadge, FooterStatusBadge, StructureBadge } from './StatusBadges';
import type { RenderMode } from '../lib/hooks/useRawblobWorker';
import type { StructuralValidation } from '../lib/workers/contentValidation';

export interface CanvasPayload {
  id: string;
  name: string;
  type: string;
  mime: string;
  buffer: ArrayBuffer;
  objectUrl?: string;
  renderMode: RenderMode;
  startOffset: number;
  endOffset: number;
  totalBufferBytes: number;
  headerHex: string;
  footerHex: string | null;
  footerFound: boolean;
  hasStandardFooter: boolean;
  structuralValidation?: StructuralValidation;
}

interface ReconstructionCanvasProps {
  payload: CanvasPayload | null;
}

function toHexDump(buffer: ArrayBuffer, maxRows = 32): string {
  const bytes = new Uint8Array(buffer);
  const rows: string[] = [];
  const rowSize = 16;
  const rowCount = Math.min(Math.ceil(bytes.length / rowSize), maxRows);

  for (let r = 0; r < rowCount; r++) {
    const start = r * rowSize;
    const slice = bytes.slice(start, start + rowSize);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')
      .padEnd(rowSize * 3 - 1, ' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
      .join('');
    rows.push(`${start.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }

  if (bytes.length > maxRows * rowSize) {
    rows.push(`… ${bytes.length - maxRows * rowSize} more bytes not shown …`);
  }
  return rows.join('\n');
}

function decodeAsText(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  } catch {
    return '(unable to decode as text)';
  }
}

function triggerGuardedDownload(payload: CanvasPayload) {
  // Executables and other inert payloads are never given a live Object URL
  // by the hook — we build one here, on demand, only for the download act
  // itself, and revoke it immediately after. This keeps a dangling
  // renderable URL from ever sitting in memory for inert content.
  const blob = new Blob([payload.buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${payload.name.replace(/\s+/g, '_')}_${payload.id}.bin`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ReconstructionCanvas({ payload }: ReconstructionCanvasProps) {
  const hexDump = useMemo(() => (payload ? toHexDump(payload.buffer) : ''), [payload]);
  const textContent = useMemo(
    () => (payload && (payload.renderMode === 'text' || payload.renderMode === 'sandboxed') ? decodeAsText(payload.buffer) : ''),
    [payload]
  );

  if (!payload) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-rb border border-rb-hairline bg-rb-panel px-6 py-16 text-center h-full min-h-[320px]">
        <p className="text-rb-muted">Select a payload to inspect it here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-rb border border-rb-hairline bg-rb-panel p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-rb-text font-medium">{payload.name}</h3>
          <p className="mt-0.5 text-xs font-mono text-rb-faint">
            {payload.mime} · offset {payload.startOffset}–{payload.endOffset} · {payload.endOffset - payload.startOffset} bytes
          </p>
        </div>
        <RenderModeBadge mode={payload.renderMode} />
      </div>

      <ByteRuler
        mode="full"
        totalBytes={payload.totalBufferBytes}
        highlightStart={payload.startOffset}
        highlightEnd={payload.endOffset}
        highlightColor={payload.renderMode === 'inert' ? 'red' : payload.renderMode === 'sandboxed' ? 'amber' : 'teal'}
      />

      {/* Signature match detail — the exact bytes that identified this format
          and bounded its extraction, so the offset shown above can be verified
          rather than taken on faith. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-rb border border-rb-hairline bg-rb-bg px-3 py-2.5 text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="text-rb-faint uppercase tracking-wide">Header</span>
          <span className="text-rb-text">{payload.headerHex}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-rb-faint uppercase tracking-wide">Footer</span>
          <span className="text-rb-text">{payload.footerHex ?? '—'}</span>
        </div>
        <FooterStatusBadge footerFound={payload.footerFound} hasStandardFooter={payload.hasStandardFooter} />
      </div>

      {/* Content-based corroboration (currently PDF only) — header/footer
          bytes alone can be coincidental, so this shows what structure was
          actually found inside the carved range, not just claimed by its
          boundaries. */}
      {payload.structuralValidation && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-rb border border-rb-hairline bg-rb-bg px-3 py-2.5 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-rb-faint uppercase tracking-wide">Interior markers</span>
            <span className="text-rb-text">
              {payload.structuralValidation.markersFound.length > 0 ? payload.structuralValidation.markersFound.join(', ') : 'none found'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-rb-faint uppercase tracking-wide">obj / endobj</span>
            <span className="text-rb-text">
              {payload.structuralValidation.objCount} / {payload.structuralValidation.endobjCount}
            </span>
          </div>
          <StructureBadge
            confidence={payload.structuralValidation.confidence}
            markersFound={payload.structuralValidation.markersFound}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Preview pane — strictly obeys renderMode */}
        <div className="rounded-rb border border-rb-hairline bg-rb-bg p-3 min-h-[220px] flex items-center justify-center overflow-auto">
          {payload.renderMode === 'image' && payload.objectUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={payload.objectUrl} alt={`Reconstructed preview of ${payload.name}`} className="max-h-[300px] max-w-full object-contain" />
          )}

          {payload.renderMode === 'text' && (
            <pre className="w-full whitespace-pre-wrap break-words text-xs font-mono text-rb-text">{textContent}</pre>
          )}

          {payload.renderMode === 'sandboxed' && payload.objectUrl && (
            <div className="w-full">
              <p className="mb-2 text-[11px] text-rb-amber font-mono">
                Rendered in an isolated, script-disabled sandbox — markup content (SVG/HTML) can carry active code.
              </p>
              <iframe
                src={payload.objectUrl}
                sandbox=""
                title={`Sandboxed preview of ${payload.name}`}
                className="w-full h-[220px] rounded border border-rb-hairline bg-white"
              />
            </div>
          )}

          {payload.renderMode === 'inert' && (
            <div className="text-center">
              <p className="text-rb-red text-sm font-medium">Executable content — preview disabled</p>
              <p className="mt-1 text-xs text-rb-faint max-w-xs">
                This payload matched an executable signature. Rawblob never renders or runs executable content — inspect the hex
                dump or download it for offline analysis.
              </p>
            </div>
          )}
        </div>

        {/* Hex dump pane — always available regardless of render mode */}
        <div className="rounded-rb border border-rb-hairline bg-rb-bg p-3 overflow-auto max-h-[300px]">
          <pre className="text-[11px] leading-relaxed font-mono text-rb-muted whitespace-pre">{hexDump}</pre>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-rb-hairline pt-4">
        <p className="text-xs text-rb-faint">
          {payload.renderMode === 'inert'
            ? 'Downloaded as a generic .bin file — it will not run on save.'
            : 'Reconstructed entirely in your browser. Nothing was uploaded to a server.'}
        </p>
        <button
          onClick={() => triggerGuardedDownload(payload)}
          className="inline-flex items-center gap-2 rounded-rb bg-rb-amber px-3 py-1.5 text-sm font-medium text-rb-bg hover:brightness-110 transition"
        >
          Download
        </button>
      </div>
    </div>
  );
}
