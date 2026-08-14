// lib/workers/rawblob.worker.ts
//
// Off-main-thread entry point. Nothing here ever touches the network or
// persistent storage — every byte stays in worker memory for the life of
// the analysis and is handed back to the main thread via transferable
// ArrayBuffers (zero-copy).

import { carveEmbeddedFiles, classifyBuffer, calculateShannonEntropy } from './carving';
import { scanAndDecodeBase64 } from './base64scanner';
import { parseQuery, searchPattern, SearchFormat } from './patternSearch';
import { extractPdfText, extractDocxText } from './textExtraction';

export type DocumentFormat = 'pdf' | 'docx';

export type WorkerInputMessage =
  | { type: 'ANALYZE_TEXT'; payload: string }
  | { type: 'ANALYZE_BUFFER'; payload: ArrayBuffer }
  | { type: 'SEARCH_PATTERN'; payload: { query: string; format: SearchFormat } }
  | { type: 'EXTRACT_DOCUMENT_TEXT'; payload: { format: DocumentFormat; buffer: ArrayBuffer } };

const MAX_BUFFER_BYTES = 15 * 1024 * 1024; // 15MB ceiling enforced here too,
// not just at the UI drag-and-drop layer — a message posted directly to
// this worker (e.g. from a future automation path) must not bypass the limit.

// Retains the most recently analyzed buffer so SEARCH_PATTERN can run
// without the main thread re-sending file bytes. Safe to keep: only the
// smaller per-carved-file *slices* (independent copies from .slice()) get
// transferred back to the main thread in ANALYZE_BUFFER below — the
// original buffer this view wraps is never transferred away, so the
// worker still fully owns it afterward.
let lastAnalyzedBytes: Uint8Array | null = null;

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  const { type, payload } = event.data;

  try {
    if (type === 'ANALYZE_TEXT') {
      if (typeof payload !== 'string') {
        throw new Error('ANALYZE_TEXT requires a string payload.');
      }
      const hits = scanAndDecodeBase64(payload);
      // Transfer every decoded buffer back with zero copy.
      const transferList = hits.map((h) => h.buffer);
      (self as unknown as Worker).postMessage(
        { status: 'SUCCESS', type: 'TEXT_SCAN_COMPLETE', payloads: hits },
        transferList as unknown as Transferable[]
      );
      return;
    }

    if (type === 'ANALYZE_BUFFER') {
      if (!(payload instanceof ArrayBuffer)) {
        throw new Error('ANALYZE_BUFFER requires an ArrayBuffer payload.');
      }
      if (payload.byteLength > MAX_BUFFER_BYTES) {
        (self as unknown as Worker).postMessage({
          status: 'ERROR',
          message: `Buffer exceeds the 15MB analysis ceiling (${payload.byteLength} bytes received).`,
        });
        return;
      }

      const bytes = new Uint8Array(payload);
      lastAnalyzedBytes = bytes;
      const topLevel = classifyBuffer(bytes);
      const wholeBufferEntropy = calculateShannonEntropy(bytes);
      const carved = carveEmbeddedFiles(bytes);

      const transferList = carved.map((c) => c.buffer);
      (self as unknown as Worker).postMessage(
        {
          status: 'SUCCESS',
          type: 'BUFFER_SCAN_COMPLETE',
          analysis: {
            topLevelSignature: topLevel,
            wholeBufferEntropy,
            size: bytes.length,
            carvedFiles: carved,
          },
        },
        transferList as unknown as Transferable[]
      );
      return;
    }

    if (type === 'SEARCH_PATTERN') {
      if (!lastAnalyzedBytes) {
        (self as unknown as Worker).postMessage({
          status: 'ERROR',
          message: 'No file loaded yet — analyze a file before searching.',
        });
        return;
      }
      const { query, format } = payload;
      const parsed = parseQuery(query, format);
      if ('error' in parsed) {
        (self as unknown as Worker).postMessage({ status: 'ERROR', message: parsed.error });
        return;
      }
      const { hits, totalMatches } = searchPattern(lastAnalyzedBytes, parsed.bytes);
      (self as unknown as Worker).postMessage({
        status: 'SUCCESS',
        type: 'PATTERN_SEARCH_COMPLETE',
        result: { hits, totalMatches, patternByteLength: parsed.bytes.length },
      });
      return;
    }

    if (type === 'EXTRACT_DOCUMENT_TEXT') {
      const { format, buffer } = payload;
      if (!(buffer instanceof ArrayBuffer)) {
        throw new Error('EXTRACT_DOCUMENT_TEXT requires an ArrayBuffer payload.');
      }
      if (buffer.byteLength > MAX_BUFFER_BYTES) {
        (self as unknown as Worker).postMessage({
          status: 'ERROR',
          message: `Buffer exceeds the 15MB analysis ceiling (${buffer.byteLength} bytes received).`,
        });
        return;
      }

      // Extraction failure (a malformed/encrypted PDF, a corrupted DOCX
      // zip) is reported as its own status rather than a hard worker
      // error — raw-buffer carving against the same file already ran
      // independently via ANALYZE_BUFFER and isn't affected by this at
      // all, so a failed extraction here shouldn't look like the whole
      // analysis failed.
      (async () => {
        try {
          const { text, warning } =
            format === 'pdf' ? await extractPdfText(buffer) : await extractDocxText(buffer);

          // Base64 scanning always runs against the FULL extracted text —
          // only the copy sent back for on-screen display is capped, so a
          // very long document can't bloat the message or the UI.
          const payloads = scanAndDecodeBase64(text);
          const DISPLAY_CAP = 200_000;
          const displayText = text.length > DISPLAY_CAP ? text.slice(0, DISPLAY_CAP) : text;
          const truncated = text.length > DISPLAY_CAP;

          const transferList = payloads.map((h) => h.buffer);
          (self as unknown as Worker).postMessage(
            {
              status: 'SUCCESS',
              type: 'DOCUMENT_TEXT_SCAN_COMPLETE',
              result: { extractedTextLength: text.length, extractedText: displayText, truncated, warning, payloads },
            },
            transferList as unknown as Transferable[]
          );
        } catch (err) {
          (self as unknown as Worker).postMessage({
            status: 'SUCCESS', // extraction failing isn't a fatal worker error
            type: 'DOCUMENT_TEXT_SCAN_COMPLETE',
            result: {
              extractedTextLength: 0,
              extractedText: '',
              truncated: false,
              warning: undefined,
              payloads: [],
              extractionError: err instanceof Error ? err.message : 'Unknown extraction failure.',
            },
          });
        }
      })();
      return;
    }

    (self as unknown as Worker).postMessage({ status: 'ERROR', message: 'Unsupported worker message type.' });
  } catch (error) {
    (self as unknown as Worker).postMessage({
      status: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown worker failure.',
    });
  }
};
