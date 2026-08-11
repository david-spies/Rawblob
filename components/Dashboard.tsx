// components/Dashboard.tsx
//
// Composes the three-panel layout and owns the session state: the current
// file's raw buffer, the merged list of telemetry rows (carved-from-buffer
// + decoded-from-base64), which row is selected for the Reconstruction
// Canvas, and manual pattern-search results. All heavy lifting happens in
// the worker via useRawblobWorker; this component is just wiring + layout.

'use client';

import { useCallback, useState } from 'react';
import { DropZone } from './DropZone';
import { TelemetryMatrix, TelemetryRow } from './TelemetryMatrix';
import { ReconstructionCanvas, CanvasPayload } from './ReconstructionCanvas';
import { PatternSearchPanel, SearchFormat, SearchHit } from './PatternSearchPanel';
import { useRawblobWorker, PreviewablePayload } from '../lib/hooks/useRawblobWorker';

interface CarvedMeta {
  headerHex: string;
  footerHex: string | null;
  footerFound: boolean;
  hasStandardFooter: boolean;
}

interface SessionItem {
  row: TelemetryRow;
  preview: PreviewablePayload;
  meta: CarvedMeta;
}

export function Dashboard() {
  const { status, error, analyzeBuffer, makePreviewable, searchPattern, reset } = useRawblobWorker();
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const handleFileAccepted = useCallback(
    async (file: File) => {
      reset();
      setItems([]);
      setSelectedId(null);
      setFileName(file.name);
      setSearchHits([]);
      setSearchTotal(null);
      setSearchError(null);

      const arrayBuffer = await file.arrayBuffer();
      setTotalBytes(arrayBuffer.byteLength);

      analyzeBuffer(arrayBuffer, (msg) => {
        if (msg.type !== 'BUFFER_SCAN_COMPLETE') return;
        const { carvedFiles } = msg.analysis;

        const nextItems: SessionItem[] = carvedFiles.map((c: any) => {
          const preview = makePreviewable({ id: c.id, type: c.type, mime: c.mime, buffer: c.buffer });
          const row: TelemetryRow = {
            id: c.id,
            origin: `Buffer offset 0x${c.startOffset.toString(16).toUpperCase()}`,
            type: c.type,
            signatureName: c.name,
            weakSignature: c.weakSignature,
            entropyScore: c.entropyScore,
            entropyConfidence: c.entropyConfidence,
            entropyConsistent: c.entropyConsistent,
            byteLength: c.byteLength,
            startOffset: c.startOffset,
            endOffset: c.endOffset,
            renderMode: preview.renderMode,
            footerFound: c.footerFound,
            hasStandardFooter: c.hasStandardFooter,
          };
          const meta: CarvedMeta = {
            headerHex: c.headerHex,
            footerHex: c.footerHex,
            footerFound: c.footerFound,
            hasStandardFooter: c.hasStandardFooter,
          };
          return { row, preview, meta };
        });

        setItems(nextItems);
        if (nextItems.length > 0) setSelectedId(nextItems[0].row.id);
      });
    },
    [analyzeBuffer, makePreviewable, reset]
  );

  const handleSearch = useCallback(
    (query: string, format: SearchFormat) => {
      setIsSearching(true);
      setSearchError(null);
      searchPattern(
        query,
        format,
        (msg) => {
          setIsSearching(false);
          if (msg.type !== 'PATTERN_SEARCH_COMPLETE') return;
          setSearchHits(msg.result.hits);
          setSearchTotal(msg.result.totalMatches);
        },
        (message) => {
          setIsSearching(false);
          setSearchError(message);
          setSearchHits([]);
          setSearchTotal(null);
        }
      );
    },
    [searchPattern]
  );

  // Jumping from a search hit selects whichever carved payload contains
  // that offset, if any — otherwise there's simply nothing to preview
  // (the hit is in a region that wasn't carved as a recognized file).
  const handleSelectSearchOffset = useCallback(
    (offset: number) => {
      const match = items.find((i) => offset >= i.row.startOffset && offset < i.row.endOffset);
      if (match) setSelectedId(match.row.id);
    },
    [items]
  );

  const selected = items.find((i) => i.row.id === selectedId);
  const selectedPayload: CanvasPayload | null = selected
    ? {
        id: selected.row.id,
        name: selected.row.signatureName,
        type: selected.row.type,
        mime: selected.preview.mime,
        buffer: selected.preview.buffer,
        objectUrl: selected.preview.objectUrl,
        renderMode: selected.preview.renderMode,
        startOffset: selected.row.startOffset,
        endOffset: selected.row.endOffset,
        totalBufferBytes: totalBytes,
        headerHex: selected.meta.headerHex,
        footerHex: selected.meta.footerHex,
        footerFound: selected.meta.footerFound,
        hasStandardFooter: selected.meta.hasStandardFooter,
      }
    : null;

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col gap-8">
      <header className="flex items-baseline justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-rb-text tracking-tight">Rawblob</h1>
          <p className="text-sm text-rb-muted mt-1">
            Forensic file carving &amp; reconstruction — entirely in your browser.
          </p>
        </div>
        {fileName && (
          <p className="text-xs font-mono text-rb-faint">
            {fileName} · {totalBytes.toLocaleString()} bytes
          </p>
        )}
      </header>

      <DropZone status={status} errorMessage={error} onFileAccepted={handleFileAccepted} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-rb-muted uppercase tracking-wide">Telemetry &amp; Inspection Matrix</h2>
        <TelemetryMatrix
          rows={items.map((i) => i.row)}
          totalBytes={totalBytes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-rb-muted uppercase tracking-wide">Reconstruction &amp; Preview Canvas</h2>
        <ReconstructionCanvas payload={selectedPayload} />
      </section>

      <section className="flex flex-col gap-3">
        <PatternSearchPanel
          disabled={totalBytes === 0}
          onSearch={handleSearch}
          hits={searchHits}
          totalMatches={searchTotal}
          error={searchError}
          isSearching={isSearching}
          onSelectOffset={handleSelectSearchOffset}
        />
      </section>
    </div>
  );
}
