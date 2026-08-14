// components/Dashboard.tsx
//
// Composes the three-panel layout and owns the session state. Two
// independent analysis paths feed the same Telemetry Matrix:
//   1. Buffer carving (always runs) — finds files embedded directly in
//      the raw bytes, regardless of format.
//   2. Text-based Base64 scanning (format-dependent) — finds Base64
//      blocks sitting in the document's rendered TEXT content, which raw
//      byte carving can't see for PDF/DOCX since their visible text is
//      stored in structured/font-encoded form, not plain ASCII bytes:
//        - .txt/.md/.csv/.log/.json: read directly as text, no extraction
//          library needed, scanned as-is.
//        - .pdf: extracted via pdfjs-dist, then scanned.
//        - .docx: extracted via mammoth, then scanned.
//        - .rtf and anything else: not attempted (RTF needs its own
//          control-word parser this doesn't have yet) — buffer carving
//          still runs against it as normal.
// All heavy lifting happens in the worker via useRawblobWorker; this
// component is just wiring + layout + routing by format.

'use client';

import { useCallback, useState } from 'react';
import { DropZone } from './DropZone';
import { TelemetryMatrix, TelemetryRow } from './TelemetryMatrix';
import { ReconstructionCanvas, CanvasPayload } from './ReconstructionCanvas';
import { PatternSearchPanel, SearchFormat, SearchHit } from './PatternSearchPanel';
import { ExtractedTextPanel } from './ExtractedTextPanel';
import { useRawblobWorker, PreviewablePayload } from '../lib/hooks/useRawblobWorker';
import type { StructuralValidation } from '../lib/workers/contentValidation';

interface ItemMeta {
  headerHex: string;
  footerHex: string | null;
  footerFound?: boolean;
  hasStandardFooter?: boolean;
  structuralValidation?: StructuralValidation;
}

interface SessionItem {
  row: TelemetryRow;
  preview: PreviewablePayload;
  meta: ItemMeta;
}

interface ExtractedTextData {
  text: string;
  textLength: number;
  truncated: boolean;
  payloadCount: number;
  warning?: string;
  sourceLabel: string;
}

type ExtractionStatus =
  | { kind: 'idle' }
  | { kind: 'not-applicable' }
  | { kind: 'extracting' }
  | { kind: 'done'; textLength: number; payloadCount: number; warning?: string }
  | { kind: 'error'; message: string };

const PLAIN_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.log', '.json']);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx === -1 ? '' : name.slice(idx).toLowerCase();
}

export function Dashboard() {
  const { status, error, analyzeBuffer, analyzeText, extractDocumentText, makePreviewable, searchPattern, reset } =
    useRawblobWorker();
  const [fileName, setFileName] = useState<string | null>(null);
  const [totalBytes, setTotalBytes] = useState(0);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraction, setExtraction] = useState<ExtractionStatus>({ kind: 'idle' });
  const [extractedText, setExtractedText] = useState<ExtractedTextData | null>(null);

  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchTotal, setSearchTotal] = useState<number | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const addBase64Items = useCallback(
    (payloads: any[]) => {
      setItems((prev) => {
        const additions: SessionItem[] = payloads.map((hit: any) => {
          const preview = makePreviewable({
            id: hit.id,
            type: hit.fileSignature.type,
            mime: hit.fileSignature.mime,
            buffer: hit.buffer,
          });
          const row: TelemetryRow = {
            id: hit.id,
            origin: `Base64 in extracted text · char ~${hit.sourceOffset}`,
            sourceKind: 'extracted-text',
            type: hit.fileSignature.type,
            signatureName: hit.fileSignature.name,
            weakSignature: hit.fileSignature.weak,
            entropyScore: hit.entropyScore,
            entropyConfidence: hit.entropyConfidence,
            entropyConsistent: hit.entropyConsistent,
            byteLength: hit.byteLength,
            startOffset: hit.sourceOffset,
            endOffset: hit.sourceOffset + hit.encodedLength,
            renderMode: preview.renderMode,
          };
          const meta: ItemMeta = {
            headerHex: toHex(new Uint8Array(hit.buffer).slice(0, 8)),
            footerHex: null,
          };
          return { row, preview, meta };
        });
        return [...prev, ...additions];
      });
    },
    [makePreviewable]
  );

  const handleFileAccepted = useCallback(
    async (file: File) => {
      reset();
      setItems([]);
      setSelectedId(null);
      setFileName(file.name);
      setSearchHits([]);
      setSearchTotal(null);
      setSearchError(null);
      setExtraction({ kind: 'idle' });
      setExtractedText(null);

      const arrayBuffer = await file.arrayBuffer();
      setTotalBytes(arrayBuffer.byteLength);

      // Path 1: buffer carving — always runs, regardless of format.
      analyzeBuffer(arrayBuffer, (msg) => {
        if (msg.type !== 'BUFFER_SCAN_COMPLETE') return;
        const { carvedFiles } = msg.analysis;

        const nextItems: SessionItem[] = carvedFiles.map((c: any) => {
          const preview = makePreviewable({ id: c.id, type: c.type, mime: c.mime, buffer: c.buffer });
          const row: TelemetryRow = {
            id: c.id,
            origin: `Buffer offset 0x${c.startOffset.toString(16).toUpperCase()}`,
            sourceKind: 'buffer',
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
            structuralValidation: c.structuralValidation,
          };
          const meta: ItemMeta = {
            headerHex: c.headerHex,
            footerHex: c.footerHex,
            footerFound: c.footerFound,
            hasStandardFooter: c.hasStandardFooter,
            structuralValidation: c.structuralValidation,
          };
          return { row, preview, meta };
        });

        setItems((prev) => [...prev, ...nextItems]);
        setSelectedId((prevSelected) => prevSelected ?? nextItems[0]?.row.id ?? null);
      });

      // Path 2: text-based Base64 scanning — format-dependent routing.
      const ext = fileExtension(file.name);

      if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
        setExtraction({ kind: 'extracting' });
        const text = await file.text();
        analyzeText(text, (msg) => {
          if (msg.type !== 'TEXT_SCAN_COMPLETE') return;
          addBase64Items(msg.payloads);
          setExtraction({ kind: 'done', textLength: text.length, payloadCount: msg.payloads.length });
          setExtractedText({
            text,
            textLength: text.length,
            truncated: false,
            payloadCount: msg.payloads.length,
            sourceLabel: 'read directly',
          });
        });
        return;
      }

      if (ext === '.pdf' || ext === '.docx') {
        setExtraction({ kind: 'extracting' });
        // A separate read: the buffer passed to analyzeBuffer above was
        // already transferred into the worker (zero-copy) and is no
        // longer usable on this side — File/Blob objects support being
        // read more than once, so this is a fresh, independent buffer.
        const extractionBuffer = await file.arrayBuffer();
        extractDocumentText(
          ext === '.pdf' ? 'pdf' : 'docx',
          extractionBuffer,
          (msg) => {
            if (msg.type !== 'DOCUMENT_TEXT_SCAN_COMPLETE') return;
            const { extractedTextLength, extractedText: text, truncated, warning, payloads, extractionError } = msg.result;
            if (extractionError) {
              setExtraction({ kind: 'error', message: extractionError });
              return;
            }
            addBase64Items(payloads);
            setExtraction({ kind: 'done', textLength: extractedTextLength, payloadCount: payloads.length, warning });
            setExtractedText({
              text,
              textLength: extractedTextLength,
              truncated,
              payloadCount: payloads.length,
              warning,
              sourceLabel: ext === '.pdf' ? 'extracted via pdfjs-dist' : 'extracted via mammoth',
            });
          },
          (message) => setExtraction({ kind: 'error', message })
        );
        return;
      }

      // RTF and anything else not yet supported for text extraction.
      setExtraction({ kind: 'not-applicable' });
    },
    [analyzeBuffer, analyzeText, extractDocumentText, makePreviewable, addBase64Items, reset]
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

  // Pattern search always runs against the raw buffer, so only rows whose
  // offsets are ALSO raw-buffer positions (sourceKind === 'buffer') can
  // ever meaningfully contain a search hit — extracted-text rows live in
  // a completely different offset space and are correctly never matched.
  const handleSelectSearchOffset = useCallback(
    (offset: number) => {
      const match = items.find((i) => i.row.sourceKind === 'buffer' && offset >= i.row.startOffset && offset < i.row.endOffset);
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
        sourceKind: selected.row.sourceKind,
        headerHex: selected.meta.headerHex,
        footerHex: selected.meta.footerHex,
        footerFound: selected.meta.footerFound,
        hasStandardFooter: selected.meta.hasStandardFooter,
        structuralValidation: selected.meta.structuralValidation,
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
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-sm font-medium text-rb-muted uppercase tracking-wide">Telemetry &amp; Inspection Matrix</h2>
          {extraction.kind !== 'idle' && (
            <p className="text-xs font-mono text-rb-faint">
              {extraction.kind === 'extracting' && 'Extracting document text…'}
              {extraction.kind === 'done' &&
                `Text scan: ${extraction.textLength.toLocaleString()} chars extracted, ${extraction.payloadCount} payload${
                  extraction.payloadCount === 1 ? '' : 's'
                } found${extraction.warning ? ` (${extraction.warning})` : ''}`}
              {extraction.kind === 'error' && <span className="text-rb-red">Text extraction failed: {extraction.message}</span>}
              {extraction.kind === 'not-applicable' && 'Text scan not available for this format — buffer carving still applies'}
            </p>
          )}
        </div>
        <TelemetryMatrix
          rows={items.map((i) => i.row)}
          totalBytes={totalBytes}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {extractedText && (
          <ExtractedTextPanel
            text={extractedText.text}
            textLength={extractedText.textLength}
            truncated={extractedText.truncated}
            payloadCount={extractedText.payloadCount}
            warning={extractedText.warning}
            sourceLabel={extractedText.sourceLabel}
          />
        )}
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
