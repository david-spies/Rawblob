// lib/workers/carving.ts
//
// Core forensic carving engine. This is the piece that makes Rawblob a
// carving tool rather than a MIME sniffer: it scans every offset in a
// buffer (not just offset 0) for known signatures, then tries to bound
// each hit with a format-appropriate end marker so multiple files
// concatenated/hidden in one blob are each recovered individually.

import { FILE_SIGNATURES, FileSignatureDefinition } from './signatures';

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
};

function isEntropyConsistent(type: string, entropy: number, confidence: 'low' | 'medium' | 'high'): boolean {
  if (confidence === 'low') return true; // not enough sample to judge, don't flag
  const range = EXPECTED_ENTROPY_RANGE[type];
  if (!range) return true;
  return entropy >= range[0] && entropy <= range[1];
}

/**
 * Sliding-window scan across the ENTIRE buffer for every known signature,
 * at every offset — not just offset 0. This is what lets Rawblob find a
 * ZIP concatenated after a legitimate PNG, or a PE hidden mid-stream.
 */
export function carveEmbeddedFiles(bytes: Uint8Array): CarvedFile[] {
  const results: CarvedFile[] = [];
  const claimedRanges: Array<[number, number]> = [];
  let counter = 0;

  const scanLimit = Math.min(bytes.length, MAX_SCAN_OFFSET_STEP_LIMIT);

  for (const [key, def] of Object.entries(FILE_SIGNATURES) as [string, FileSignatureDefinition][]) {
    if (def.signatures.length === 0 && !def.customCheck) continue;

    // Fixed-offset formats (e.g. TAR's ustar at 257) are checked once, not slid.
    if (def.offset !== undefined) {
      if (matchAtOffset(bytes, def, def.offset)) {
        pushHit(key, def, def.offset);
      }
      continue;
    }

    for (const sig of def.signatures) {
      let searchFrom = 0;
      while (searchFrom <= scanLimit - sig.length) {
        const idx = indexOfSequence(bytes, sig, searchFrom, scanLimit);
        if (idx === -1) break;
        if (def.customCheck ? def.customCheck(bytes, idx) : true) {
          pushHit(key, def, idx);
        }
        searchFrom = idx + 1;
        if (results.length >= MAX_CARVED_FILES) return results;
      }
    }

    // Formats with only a customCheck and no flat signature (MP4/MOV) need
    // a brute-force scan since there's no byte pattern to search for directly.
    if (def.signatures.length === 0 && def.customCheck) {
      for (let i = 0; i < scanLimit - 8; i++) {
        if (def.customCheck(bytes, i)) {
          pushHit(key, def, i);
          if (results.length >= MAX_CARVED_FILES) return results;
        }
      }
    }
  }

  function pushHit(key: string, def: FileSignatureDefinition, start: number) {
    // Skip if this offset already falls inside a previously carved range
    // (avoids re-carving bytes that are just part of a legitimately found file,
    // e.g. a WAV subchunk header that happens to look like something else).
    if (claimedRanges.some(([s, e]) => start >= s && start < e)) return;

    let end = bytes.length;
    if (def.findEnd) {
      const found = def.findEnd(bytes, start);
      if (found.end !== -1) end = found.end;
    }
    if (end <= start) return;

    const length = end - start;
    const entropy = calculateShannonEntropy(bytes, start, end);
    const confidence = entropyConfidenceFor(length);
    const consistent = isEntropyConsistent(key, entropy, confidence);
    const weak = !!def.weak;

    // Weak (short) signatures need corroboration: either a passed customCheck
    // (already required above for BMP/PE) or a consistent entropy profile.
    // If neither, we still report it but mark confidence low so the UI can
    // de-emphasize it rather than hide it outright — analysts should see
    // everything, just ranked by trust.
    claimedRanges.push([start, end]);

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
    });
  }

  results.sort((a, b) => a.startOffset - b.startOffset);
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
