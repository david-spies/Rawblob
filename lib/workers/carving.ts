// lib/workers/carving.ts
//
// Core forensic carving engine. This is the piece that makes Rawblob a
// carving tool rather than a MIME sniffer: it scans every offset in a
// buffer (not just offset 0) for known signatures, then tries to bound
// each hit with a format-appropriate end marker so multiple files
// concatenated/hidden in one blob are each recovered individually.

import { FILE_SIGNATURES, FileSignatureDefinition } from './signatures';
import { analyzePdfStructure, StructuralValidation } from './contentValidation';

export interface CarvedFile {
  id: string;
  type: string;
  name: string;
  mime: string;
  startOffset: number;
  endOffset: number; // exclusive
  byteLength: number;
  entropyScore: number;
  entropyConfidence: 'low' | 'medium' | 'high';
  entropyConsistent: boolean; // does entropy match what's expected for this format?
  weakSignature: boolean;
  buffer: ArrayBuffer;
  /** Hex preview of the matched header bytes, for display/verification in the UI. */
  headerHex: string;
  /** Hex preview of the matched footer bytes, or null if no footer was located. */
  footerHex: string | null;
  /** True if a real end-of-file marker was located; false means endOffset falls
   *  back to the rest of the buffer and should be shown as an estimate, not a fact. */
  footerFound: boolean;
  /** True if this format doesn't have a standardized trailing marker at all
   *  (MP3/MP4/WAV/EXE/RAR/etc) — a missing footer here is expected, not suspicious. */
  hasStandardFooter: boolean;
  /** Content-based corroboration (currently PDF only): whether the carved
   *  range actually contains structure intrinsic to the format, not just
   *  a matching header/footer. Undefined for formats without a content
   *  scan implemented yet. */
  structuralValidation?: StructuralValidation;
}

const MIN_ENTROPY_SAMPLE = 128; // below this, entropy is statistically unreliable
const MAX_CARVED_FILES = 500; // guardrail against pathological inputs
const MAX_SCAN_OFFSET_STEP_LIMIT = 5_000_000; // don't scan more than this many start offsets per buffer

export function calculateShannonEntropy(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const len = end - start;
  if (len <= 0) return 0;

  const frequencies = new Uint32Array(256);
  for (let i = start; i < end; i++) {
    frequencies[bytes[i]]++;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const p = frequencies[i] / len;
      entropy -= p * Math.log2(p);
    }
  }
  return Number(entropy.toFixed(4));
}

function entropyConfidenceFor(sampleSize: number): 'low' | 'medium' | 'high' {
  if (sampleSize < MIN_ENTROPY_SAMPLE) return 'low';
  if (sampleSize < 1024) return 'medium';
  return 'high';
}

/**
 * A rough expected-entropy band per format, used to flag internal
 * inconsistency: e.g. a "PNG" hit with entropy of 1.2 is suspicious,
 * since real deflate-compressed PNG data should read ~6.5-8.0.
 */
const EXPECTED_ENTROPY_RANGE: Record<string, [number, number]> = {
  JPEG: [7.2, 8.0],
  PNG: [6.5, 8.0],
  GIF: [6.0, 8.0],
  GZIP: [7.5, 8.0],
  ZIP: [7.0, 8.0],
  SEVEN_ZIP: [7.5, 8.0],
  RAR: [7.5, 8.0],
  WEBP: [6.0, 8.0],
  MP3: [6.5, 8.0],
  MP4_MOV: [5.0, 8.0],
  PDF: [0.5, 8.0], // container format with huge legitimate variance: a
  // text-only PDF can sit under 4.0, while one embedding compressed
  // images or streams (like the JPEG carved out of it above) can
  // legitimately read near 8.0. Only flag the degenerate near-zero case
  // (e.g. an all-repeated-byte buffer with a spoofed header).
  BMP: [3.0, 8.0], // depends heavily on image content
  TAR: [0.0, 8.0], // wraps arbitrary content
  ELF: [4.0, 7.5],
  PE: [4.0, 7.9],
  TIFF_INTEL: [3.0, 8.0],
  TIFF_MOTOROLA: [3.0, 8.0],
  WAV: [3.0, 8.0],
  SVG: [0.5, 7.5], // plain XML text usually reads low-moderate, but an
  // SVG embedding a base64 data: URI image can legitimately spike much
  // higher — kept permissive on purpose after the PDF false-positive
  // lesson above.
};

function isEntropyConsistent(type: string, entropy: number, confidence: 'low' | 'medium' | 'high'): boolean {
  if (confidence === 'low') return true; // not enough sample to judge, don't flag
  const range = EXPECTED_ENTROPY_RANGE[type];
  if (!range) return true;
  return entropy >= range[0] && entropy <= range[1];
}

interface Candidate {
  key: string;
  def: FileSignatureDefinition;
  start: number;
}

const MAX_CANDIDATES = MAX_CARVED_FILES * 10; // generous ceiling before sort/resolve

/**
 * Sliding-window scan across the ENTIRE buffer for every known signature,
 * at every offset — not just offset 0. This is what lets Rawblob find a
 * ZIP concatenated after a legitimate PNG, or a PE hidden mid-stream.
 *
 * Runs in two phases:
 *   1. Collect every validated header match (start offset only) across
 *      every format, regardless of buffer position.
 *   2. Sort those candidates left-to-right, then resolve each one's end
 *      offset in that order. This is what lets an unbounded fallback (no
 *      footer found, or the format has no standard footer at all) stop at
 *      the next known file's start offset instead of claiming the rest of
 *      the buffer — previously, an early-in-object-order format with no
 *      footer (e.g. GZIP) could claim a range that fully overlapped a
 *      later, correctly-bounded file (e.g. a PNG) found right after it,
 *      reporting both to the analyst as if each independently owned those
 *      bytes.
 */
export function carveEmbeddedFiles(bytes: Uint8Array): CarvedFile[] {
  const scanLimit = Math.min(bytes.length, MAX_SCAN_OFFSET_STEP_LIMIT);
  const candidates: Candidate[] = [];

  outer: for (const [key, def] of Object.entries(FILE_SIGNATURES) as [string, FileSignatureDefinition][]) {
    if (def.signatures.length === 0 && !def.customCheck) continue;

    // Fixed-offset formats (e.g. TAR's ustar at 257) are checked once, not slid.
    if (def.offset !== undefined) {
      if (matchAtOffset(bytes, def, def.offset)) {
        candidates.push({ key, def, start: def.offset });
      }
      continue;
    }

    for (const sig of def.signatures) {
      let searchFrom = 0;
      while (searchFrom <= scanLimit - sig.length) {
        const idx = indexOfSequence(bytes, sig, searchFrom, scanLimit);
        if (idx === -1) break;
        if (def.customCheck ? def.customCheck(bytes, idx) : true) {
          candidates.push({ key, def, start: idx });
          if (candidates.length >= MAX_CANDIDATES) break outer;
        }
        searchFrom = idx + 1;
      }
    }

    // Formats with only a customCheck and no flat signature (MP4/MOV) need
    // a brute-force scan since there's no byte pattern to search for directly.
    if (def.signatures.length === 0 && def.customCheck) {
      for (let i = 0; i < scanLimit - 8; i++) {
        if (def.customCheck(bytes, i)) {
          candidates.push({ key, def, start: i });
          if (candidates.length >= MAX_CANDIDATES) break outer;
        }
      }
    }
  }

  candidates.sort((a, b) => a.start - b.start);

  // Precompute, for each candidate, the start offset of the next candidate
  // with a strictly greater start (skipping same-offset ties from other
  // formats matching the same position) — this is the boundary an
  // unbounded fallback must not cross. O(n) via a backward pass.
  const nextDistinctStart: number[] = new Array(candidates.length).fill(-1);
  for (let i = candidates.length - 2; i >= 0; i--) {
    nextDistinctStart[i] = candidates[i + 1].start > candidates[i].start ? candidates[i + 1].start : nextDistinctStart[i + 1];
  }

  function toHex(slice: Uint8Array): string {
    return Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  }

  const results: CarvedFile[] = [];
  let counter = 0;
  let cursor = 0; // end offset of the most recently accepted hit

  for (let i = 0; i < candidates.length; i++) {
    const { key, def, start } = candidates[i];
    if (start < cursor) continue; // falls inside a previously accepted hit — skip

    let end = bytes.length;
    let footerFound = false;
    if (def.findEnd) {
      const found = def.findEnd(bytes, start);
      if (found.end !== -1) {
        end = found.end;
        footerFound = true;
      }
    }

    if (!footerFound) {
      // No confirmed end marker — cap the fallback at the next known
      // file's start offset rather than the rest of the buffer.
      const cap = nextDistinctStart[i];
      if (cap !== -1 && cap < end) end = cap;
    }

    if (end <= start) continue;

    const length = end - start;
    const entropy = calculateShannonEntropy(bytes, start, end);
    const confidence = entropyConfidenceFor(length);
    const consistent = isEntropyConsistent(key, entropy, confidence);
    const weak = !!def.weak;

    const headerHex = toHex(bytes.slice(start, Math.min(start + 8, end)));
    const footerHex = footerFound ? toHex(bytes.slice(Math.max(start, end - 8), end)) : null;

    // Content-based corroboration, currently PDF only: header/footer bytes
    // alone can be coincidental (proven directly by the JPEG false
    // positive found earlier), so for PDF specifically also check that
    // real object-model structure exists inside the carved range.
    const structuralValidation = key === 'PDF' ? analyzePdfStructure(bytes, start, end) : undefined;

    results.push({
      id: `carved-${counter++}`,
      type: key,
      name: def.name,
      mime: def.mime,
      startOffset: start,
      endOffset: end,
      byteLength: length,
      entropyScore: entropy,
      entropyConfidence: confidence,
      entropyConsistent: consistent,
      weakSignature: weak,
      buffer: bytes.buffer.slice(start, end) as ArrayBuffer,
      headerHex,
      footerHex,
      footerFound,
      hasStandardFooter: def.hasStandardFooter,
      structuralValidation,
    });

    cursor = end;
    if (results.length >= MAX_CARVED_FILES) break;
  }

  return results;
}

function matchAtOffset(bytes: Uint8Array, def: FileSignatureDefinition, offset: number): boolean {
  for (const sig of def.signatures) {
    if (bytes.length < offset + sig.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (bytes[offset + i] !== sig[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

function indexOfSequence(bytes: Uint8Array, seq: number[], from: number, upto: number): number {
  outer: for (let i = from; i <= upto - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Classifies a whole buffer (no carving) — used for the top-level uploaded file itself. */
export function classifyBuffer(bytes: Uint8Array) {
  for (const [key, def] of Object.entries(FILE_SIGNATURES)) {
    if (def.customCheck && def.customCheck(bytes, 0)) {
      return { type: key, name: def.name, mime: def.mime, weak: !!def.weak };
    }
    const offset = def.offset ?? 0;
    if (matchAtOffset(bytes, def, offset)) {
      return { type: key, name: def.name, mime: def.mime, weak: !!def.weak };
    }
  }
  return { type: 'OCTET_STREAM', name: 'Raw Binary Blob', mime: 'application/octet-stream', weak: false };
}
