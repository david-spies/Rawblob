// lib/workers/contentValidation.ts
//
// Header/footer matches alone can be coincidental — proven directly by
// the JPEG false positive found earlier (a 3-byte SOI match inside
// unrelated compressed data). PDF's 4-byte header and 5-byte footer are
// individually more distinctive than JPEG's marker bytes, but the same
// class of risk still applies, and — per "An Alternative Approach to Data
// Carving Portable Document Format (PDF) Files" (adapting Booker 2021) —
// a content-aware check that looks for structure *inside* the file, not
// just at its boundaries, is also the technique that recovers PDFs whose
// header/footer bytes have been deliberately obfuscated. This module
// implements the corroboration half of that idea: given a candidate PDF
// range, scan its interior for the ASCII structural tokens that are
// intrinsic to the PDF object model (`obj`/`endobj`, `stream`/`endstream`,
// `xref`, `trailer`, `/Root`) and report how much genuine structure was
// actually found, rather than trusting the header/footer bytes alone.

export interface StructuralValidation {
  /** Which structural tokens were found at least once in the carved range. */
  markersFound: string[];
  /** Rough count of "obj" and "endobj" occurrences — the one pairing that's
   *  present in virtually every real PDF, regardless of PDF version. */
  objCount: number;
  endobjCount: number;
  /** Overall confidence that this is genuine PDF content, not just a
   *  coincidental header/footer match. */
  confidence: 'high' | 'medium' | 'low';
}

interface MarkerDef {
  label: string;
  bytes: number[];
}

function toBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

// Core object-model tokens (present in effectively all real PDFs) plus
// classic cross-reference tokens (present in most PDFs, but can be absent
// in PDFs that use compressed cross-reference *streams* instead of a
// classic "xref"/"trailer" keyword table — a PDF 1.5+ feature common in
// output from modern PDF libraries). Tiering below accounts for that.
const OBJ_MARKER: MarkerDef = { label: 'obj', bytes: toBytes('obj') };
const ENDOBJ_MARKER: MarkerDef = { label: 'endobj', bytes: toBytes('endobj') };
const BONUS_MARKERS: MarkerDef[] = [
  { label: 'stream', bytes: toBytes('stream') },
  { label: 'endstream', bytes: toBytes('endstream') },
  { label: 'xref', bytes: toBytes('xref') },
  { label: 'trailer', bytes: toBytes('trailer') },
  { label: '/Root', bytes: toBytes('/Root') },
];

function countOccurrences(bytes: Uint8Array, start: number, end: number, needle: number[]): number {
  if (needle.length === 0 || end - start < needle.length) return 0;
  let count = 0;
  outer: for (let i = start; i <= end - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    count++;
  }
  return count;
}

/**
 * Scans a carved PDF's interior for structural markers and derives a
 * confidence tier. This is deliberately separate from header/footer
 * validation — a candidate can have a perfectly matched header and footer
 * and still fail this check if nothing PDF-like exists between them,
 * which is exactly the signature obfuscation / coincidental-match case
 * this is meant to catch.
 */
export function analyzePdfStructure(bytes: Uint8Array, start: number, end: number): StructuralValidation {
  const objCount = countOccurrences(bytes, start, end, OBJ_MARKER.bytes);
  const endobjCount = countOccurrences(bytes, start, end, ENDOBJ_MARKER.bytes);

  const markersFound: string[] = [];
  if (objCount > 0) markersFound.push(OBJ_MARKER.label);
  if (endobjCount > 0) markersFound.push(ENDOBJ_MARKER.label);
  for (const marker of BONUS_MARKERS) {
    if (countOccurrences(bytes, start, end, marker.bytes) > 0) {
      markersFound.push(marker.label);
    }
  }

  const hasCoreObjectPair = objCount > 0 && endobjCount > 0;
  const hasBonusEvidence = markersFound.some((m) => BONUS_MARKERS.some((b) => b.label === m));

  let confidence: StructuralValidation['confidence'];
  if (hasCoreObjectPair && hasBonusEvidence) {
    confidence = 'high';
  } else if (hasCoreObjectPair) {
    // obj/endobj present but none of the classic xref/trailer/stream
    // tokens — plausible for a PDF using compressed cross-reference
    // streams (PDF 1.5+), so this still counts as real structure, just
    // with less corroborating evidence.
    confidence = 'medium';
  } else {
    // No obj/endobj pairing at all inside a "PDF" — a real PDF with at
    // least one object (which is effectively all of them) always has
    // this. Its absence is a strong signal that the %PDF/%%EOF match is
    // coincidental rather than genuine PDF content.
    confidence = 'low';
  }

  return { markersFound, objCount, endobjCount, confidence };
}
