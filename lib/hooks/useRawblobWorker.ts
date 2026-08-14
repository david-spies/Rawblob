// lib/hooks/useRawblobWorker.ts
//
// Manages the worker lifecycle and, critically, the lifecycle of every
// Object URL created for a preview. URL.createObjectURL leaks memory if
// never paired with a revoke — with sessions that can generate dozens of
// carved payloads from a single 15MB file, that adds up fast. Every URL
// created here is tracked and revoked on reset/unmount.
//
// This hook also assigns a `renderMode` per payload so the UI never
// executes attacker-controlled content:
//   - 'image'      : safe to render in <img>
//   - 'text'       : safe to render as escaped text (never innerHTML)
//   - 'sandboxed'  : must only render inside a <iframe sandbox="">
//                    with no allow-scripts (SVG, HTML-shaped payloads)
//   - 'inert'      : never rendered live — hex dump + guarded download only
//                    (PE, ELF, and anything else executable)

import { useCallback, useEffect, useRef, useState } from 'react';

export type RenderMode = 'image' | 'text' | 'sandboxed' | 'inert';

export interface PreviewablePayload {
  id: string;
  mime: string;
  type: string;
  buffer: ArrayBuffer;
  objectUrl?: string;
  renderMode: RenderMode;
}

const EXECUTABLE_TYPES = new Set(['PE', 'ELF']);
const MARKUP_MIMES = new Set(['image/svg+xml', 'text/html']);
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/tiff', 'image/webp']);

function resolveRenderMode(type: string, mime: string): RenderMode {
  if (EXECUTABLE_TYPES.has(type)) return 'inert';
  if (MARKUP_MIMES.has(mime)) return 'sandboxed'; // SVG can carry <script> — never trust it as an <img> src blindly rendered via innerHTML
  if (IMAGE_MIMES.has(mime)) return 'image';
  if (type === 'OCTET_STREAM') return 'text'; // shown as hex/plain, never executed
  return 'text';
}

export function useRawblobWorker() {
  const workerRef = useRef<Worker | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(new URL('../workers/rawblob.worker.ts', import.meta.url), {
      type: 'module',
    });
    return () => {
      workerRef.current?.terminate();
      revokeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revokeAll = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
  }, []);

  const makePreviewable = useCallback(
    (item: { id: string; type: string; mime: string; buffer: ArrayBuffer }): PreviewablePayload => {
      const renderMode = resolveRenderMode(item.type, item.mime);
      let objectUrl: string | undefined;

      // Only ever create a live Object URL for modes we're prepared to
      // render safely. Inert payloads (executables) get no URL at all
      // until the user explicitly requests a guarded download.
      if (renderMode === 'image' || renderMode === 'sandboxed') {
        const blob = new Blob([item.buffer], { type: item.mime });
        objectUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(objectUrl);
      }

      return { id: item.id, mime: item.mime, type: item.type, buffer: item.buffer, objectUrl, renderMode };
    },
    []
  );

  /** Call when swapping files or resetting the dashboard — frees all prior preview memory. */
  const reset = useCallback(() => {
    revokeAll();
    setStatus('idle');
    setError(null);
  }, [revokeAll]);

  const analyzeBuffer = useCallback((buffer: ArrayBuffer, onResult: (msg: any) => void) => {
    if (!workerRef.current) return;
    setStatus('analyzing');
    setError(null);

    const handle = (e: MessageEvent) => {
      if (e.data.status === 'ERROR') {
        setStatus('error');
        setError(e.data.message);
      } else {
        setStatus('idle');
        onResult(e.data);
      }
      workerRef.current?.removeEventListener('message', handle);
    };
    workerRef.current.addEventListener('message', handle);
    workerRef.current.postMessage({ type: 'ANALYZE_BUFFER', payload: buffer }, [buffer]);
  }, []);

  const analyzeText = useCallback((text: string, onResult: (msg: any) => void) => {
    if (!workerRef.current) return;
    setStatus('analyzing');
    setError(null);

    const handle = (e: MessageEvent) => {
      if (e.data.status === 'ERROR') {
        setStatus('error');
        setError(e.data.message);
      } else {
        setStatus('idle');
        onResult(e.data);
      }
      workerRef.current?.removeEventListener('message', handle);
    };
    workerRef.current.addEventListener('message', handle);
    workerRef.current.postMessage({ type: 'ANALYZE_TEXT', payload: text });
  }, []);

  const searchPattern = useCallback(
    (query: string, format: 'hex' | 'ascii' | 'decimal', onResult: (msg: any) => void, onError: (msg: string) => void) => {
      if (!workerRef.current) return;

      const handle = (e: MessageEvent) => {
        if (e.data.status === 'ERROR') {
          onError(e.data.message);
        } else {
          onResult(e.data);
        }
        workerRef.current?.removeEventListener('message', handle);
      };
      workerRef.current.addEventListener('message', handle);
      workerRef.current.postMessage({ type: 'SEARCH_PATTERN', payload: { query, format } });
    },
    []
  );

  const extractDocumentText = useCallback(
    (format: 'pdf' | 'docx', buffer: ArrayBuffer, onResult: (msg: any) => void, onError: (msg: string) => void) => {
      if (!workerRef.current) return;

      const handle = (e: MessageEvent) => {
        if (e.data.status === 'ERROR') {
          onError(e.data.message);
        } else {
          onResult(e.data);
        }
        workerRef.current?.removeEventListener('message', handle);
      };
      workerRef.current.addEventListener('message', handle);
      workerRef.current.postMessage({ type: 'EXTRACT_DOCUMENT_TEXT', payload: { format, buffer } }, [buffer]);
    },
    []
  );

  return { status, error, analyzeBuffer, analyzeText, searchPattern, extractDocumentText, makePreviewable, reset };
}
