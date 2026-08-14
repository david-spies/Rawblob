// lib/workers/textExtraction.ts
//
// Extracts plain text from PDF and DOCX buffers so their content can be
// fed into the existing Base64 payload scanner (base64scanner.ts), which
// only operates on already-decoded text. This is additive, not a
// replacement: raw-buffer carving (finding files embedded directly in the
// binary — e.g. a JPEG inside a PDF) is completely unaffected and keeps
// running against the original bytes regardless of format. This module
// only adds a second, independent pass that also looks for Base64 blocks
// sitting in the document's rendered TEXT content (e.g. pasted into a
// paragraph) — something raw byte carving can't see, since a PDF/DOCX's
// visible text is stored in structured/font-encoded form in the file,
// not as plain ASCII bytes at the raw level.
//
// Uses pdfjs-dist's `legacy` build specifically, not the main build — the
// main build depends on very recent Web Platform APIs (DOMMatrix,
// Promise.try, WebCrypto with Uint8Array.toHex) that not every current
// browser ships yet; the legacy build was verified end-to-end against a
// real generated PDF with zero polyfills needed, which is also a strong
// signal of broader real-world compatibility.

// @ts-ignore — pdfjs-dist ships its own types but the legacy subpath's
// resolution can vary by bundler config; the runtime shape is verified.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as mammoth from 'mammoth';

// Explicitly configure the worker source rather than relying on pdfjs's
// internal "leave it unset, let it throw and fall back" behavior. That
// fallback was verified to work for a simple test PDF, but real-world
// testing found it does NOT cover every internal code path — some PDFs
// (likely ones exercising specific font-handling or content-stream
// operations) reference GlobalWorkerOptions.workerSrc from a location
// that isn't wrapped in the same try/catch, surfacing as a hard failure
// instead of a silent fallback. Setting this explicitly sidesteps the
// issue entirely rather than patching around an internal code path this
// project doesn't control.
//
// `new URL(..., import.meta.url)` is the standard bundler-resolvable
// pattern webpack 5+ and Turbopack both support for resolving an asset
// URL relative to the current module, including into a package's
// internals — this causes pdfjs to spawn a real (nested) Worker for
// parsing rather than running in-process. Nested Workers are supported in
// all current major browsers, so running inside our own Rawblob worker
// isn't a blocker.
if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
}

export interface ExtractionResult {
  text: string;
  warning?: string;
}

export async function extractPdfText(buffer: ArrayBuffer): Promise<ExtractionResult> {
  try {
    const data = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data,
      // Optional but recommended for full-fidelity extraction of PDFs
      // using non-embedded standard fonts or CJK/custom character maps —
      // see README for the one-time asset copy step. Extraction still
      // succeeds without these for the common case (embedded fonts,
      // Latin text), just with a console warning from pdfjs.
      standardFontDataUrl: '/standard_fonts/',
      cMapUrl: '/pdf-cmaps/',
      cMapPacked: true,
    });
    const pdf = await loadingTask.promise;

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map((item: any) => ('str' in item ? item.str : '')).join(' ');
      fullText += pageText + '\n';
    }

    return { text: fullText };
  } catch (err) {
    throw new Error(`PDF text extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}

export async function extractDocxText(buffer: ArrayBuffer): Promise<ExtractionResult> {
  try {
    // Browser API surface: mammoth's package.json remaps its internal
    // zip/file-reading modules to browser-compatible implementations, and
    // the public API takes { arrayBuffer } in that environment (the
    // Node-only entry point instead takes a Node Buffer via { buffer }).
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const warning = result.messages.length > 0 ? `${result.messages.length} extraction warning(s) from mammoth` : undefined;
    return { text: result.value, warning };
  } catch (err) {
    throw new Error(`DOCX text extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
}
