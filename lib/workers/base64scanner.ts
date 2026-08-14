// lib/workers/base64scanner.ts
//
// The naive version of this scanner (length >= 32 and matches the base64
// charset) flags nearly everything: hashes, UUID runs, JWT segments, long
// URLs, tokens. atob() will happily decode almost any such string, so a
// length check alone produces mostly noise. This version only surfaces a
// hit once it clears an "interestingness" bar:
//   1. It decodes to bytes matching a known file signature, OR
//   2. It decodes to a long run of printable/plausible UTF-8 text, OR
//   3. Its entropy is high enough (with adequate sample size) to look like
//      deliberately encoded binary rather than incidental text.
// Everything else is dropped rather than shown, so analysts aren't stuck
// triaging hundreds of coincidental matches per document.

import { calculateShannonEntropy, isEntropyConsistent } from './carving';
import { classifyBuffer } from './carving';

export interface Base64Hit {
  id: string;
  previewSnippet: string;
  byteLength: number;
  entropyScore: number;
  entropyConfidence: 'low' | 'medium' | 'high';
  entropyConsistent: boolean;
  fileSignature: { type: string; name: string; mime: string; weak: boolean };
  reason: 'signature-match' | 'printable-text' | 'high-entropy-binary';
  confidence: 'low' | 'medium' | 'high';
  buffer: ArrayBuffer;
  /** Character offset into the source text where this Base64 block starts. */
  sourceOffset: number;
  /** Character span of the encoded block in the source text — distinct
   *  from byteLength, which is the DECODED byte count. */
  encodedLength: number;
}

const MIN_CANDIDATE_LENGTH = 40; // encoded-string length, not decoded byte length
const MIN_DECODED_TEXT_LENGTH = 24;

const base64Regex = /[A-Za-z0-9+/]{40,}={0,2}/g;

function isLikelyPrintableText(bytes: Uint8Array): { printable: boolean; ratio: number } {
  if (bytes.length === 0) return { printable: false, ratio: 0 };
  let printableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Printable ASCII, tab, newline, carriage return
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) {
      printableCount++;
    }
  }
  const ratio = printableCount / bytes.length;
  return { printable: ratio > 0.92, ratio };
}

export function scanAndDecodeBase64(text: string): Base64Hit[] {
  const hits: Base64Hit[] = [];
  const matches = text.matchAll(base64Regex);
  let counter = 0;

  for (const match of matches) {
    const encoded = match[0];
    if (encoded.length < MIN_CANDIDATE_LENGTH) continue;

    let bytes: Uint8Array;
    try {
      const binaryString = atob(encoded);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } catch {
      continue; // not valid base64 padding/charset — discard silently
    }

    if (bytes.length === 0) continue;

    const signature = classifyBuffer(bytes);
    const entropy = calculateShannonEntropy(bytes);
    const confidenceFromSize = bytes.length < 128 ? 'low' : bytes.length < 1024 ? 'medium' : 'high';
    const offset = match.index ?? 0;

    // Gate 1: matches a known file signature — always worth surfacing.
    if (signature.type !== 'OCTET_STREAM') {
      const consistent = isEntropyConsistent(signature.type, entropy, confidenceFromSize);
      hits.push(
        buildHit(counter++, encoded, bytes, entropy, confidenceFromSize, consistent, signature, 'signature-match',
          signature.weak ? 'medium' : 'high', offset)
      );
      continue;
    }

    // Gate 2: decodes to substantial printable text — likely an embedded
    // plaintext payload (config, credentials, source, message) rather than
    // random noise.
    const { printable } = isLikelyPrintableText(bytes);
    if (printable && bytes.length >= MIN_DECODED_TEXT_LENGTH) {
      // No format signature to check entropy expectations against —
      // "consistent" isn't a meaningful question here, so default true
      // rather than risk a false "inconsistent" flag with nothing to
      // compare against.
      hits.push(
        buildHit(counter++, encoded, bytes, entropy, confidenceFromSize, true, signature, 'printable-text', 'medium', offset)
      );
      continue;
    }

    // Gate 3: high entropy with an adequate sample size suggests deliberately
    // encoded binary (encrypted/compressed) rather than an incidental base64-
    // shaped string. Below the sample-size floor we don't trust entropy at
    // all and drop the candidate rather than guess.
    if (bytes.length >= 128 && entropy >= 7.0) {
      hits.push(
        buildHit(counter++, encoded, bytes, entropy, confidenceFromSize, true, signature, 'high-entropy-binary', 'low', offset)
      );
      continue;
    }

    // Otherwise: not a signature match, not readable text, not clearly
    // high-entropy binary — most likely a hash, token, or incidental
    // alphanumeric run. Discard.
  }

  return hits;
}

function buildHit(
  counter: number,
  encoded: string,
  bytes: Uint8Array,
  entropy: number,
  entropyConfidence: 'low' | 'medium' | 'high',
  entropyConsistent: boolean,
  signature: { type: string; name: string; mime: string; weak: boolean },
  reason: Base64Hit['reason'],
  confidence: Base64Hit['confidence'],
  sourceOffset: number
): Base64Hit {
  return {
    id: `b64-${counter}`,
    previewSnippet: encoded.slice(0, 32) + (encoded.length > 32 ? '...' : ''),
    byteLength: bytes.length,
    entropyScore: entropy,
    entropyConfidence,
    entropyConsistent,
    fileSignature: signature,
    reason,
    confidence,
    buffer: bytes.buffer as ArrayBuffer,
    sourceOffset,
    encodedLength: encoded.length,
  };
}
