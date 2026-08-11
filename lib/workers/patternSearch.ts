// lib/workers/patternSearch.ts
//
// Manual forensic search: the analyst supplies a byte pattern in one of
// three input formats and gets back every offset it occurs at in the
// currently loaded buffer. This is deliberately separate from the
// automatic carving engine — it's a "find" tool for verifying a specific
// signature, checking a hunch, or looking for something not in the
// built-in signature database at all.

export type SearchFormat = 'hex' | 'ascii' | 'decimal';

export interface ParsedQuery {
  bytes: Uint8Array;
}

export interface ParseError {
  error: string;
}

export interface SearchHit {
  offset: number;
  contextHex: string; // a few bytes of surrounding context, hex-formatted
}

const MAX_HITS = 500; // guardrail: a 1-byte pattern in a 15MB file could
// otherwise produce millions of hits and lock up the UI. We still report
// the true total count separately so the analyst knows results were capped.

export function parseQuery(query: string, format: SearchFormat): ParsedQuery | ParseError {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { error: 'Enter a pattern to search for.' };
  }

  if (format === 'hex') {
    // Accept "FF D8 FF", "ffd8ff", "FF-D8-FF", "0xFF 0xD8 0xFF" — normalize
    // by stripping everything but hex digits, then require an even count.
    const cleaned = trimmed.replace(/0x/gi, '').replace(/[^0-9a-fA-F]/g, '');
    if (cleaned.length === 0) {
      return { error: 'No valid hex digits found.' };
    }
    if (cleaned.length % 2 !== 0) {
      return { error: `Hex pattern has an odd number of digits (${cleaned.length}) — each byte needs two hex digits.` };
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return { bytes };
  }

  if (format === 'ascii') {
    const encoder = new TextEncoder();
    return { bytes: encoder.encode(trimmed) };
  }

  if (format === 'decimal') {
    // Accept "255 216 255", "255,216,255", "255, 216, 255"
    const parts = trimmed.split(/[\s,]+/).filter((p) => p.length > 0);
    if (parts.length === 0) {
      return { error: 'No decimal values found.' };
    }
    const bytes = new Uint8Array(parts.length);
    for (let i = 0; i < parts.length; i++) {
      const n = Number(parts[i]);
      if (!Number.isInteger(n) || n < 0 || n > 255) {
        return { error: `"${parts[i]}" isn't a valid byte value — each must be a whole number from 0 to 255.` };
      }
      bytes[i] = n;
    }
    return { bytes };
  }

  return { error: `Unknown search format: ${format}` };
}

export function searchPattern(bytes: Uint8Array, pattern: Uint8Array): { hits: SearchHit[]; totalMatches: number } {
  const hits: SearchHit[] = [];
  let totalMatches = 0;

  if (pattern.length === 0 || pattern.length > bytes.length) {
    return { hits, totalMatches };
  }

  outer: for (let i = 0; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    totalMatches++;
    if (hits.length < MAX_HITS) {
      const ctxStart = Math.max(0, i - 4);
      const ctxEnd = Math.min(bytes.length, i + pattern.length + 4);
      hits.push({
        offset: i,
        contextHex: Array.from(bytes.slice(ctxStart, ctxEnd))
          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
          .join(' '),
      });
    }
  }

  return { hits, totalMatches };
}
