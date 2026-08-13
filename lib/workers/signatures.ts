// lib/workers/signatures.ts
//
// Enterprise-grade file signature dictionary.
// Each entry can define:
//  - one or more start signatures (multi-variant formats like MP3)
//  - an offset (e.g. TAR's "ustar" at byte 257)
//  - a customCheck for structural validation beyond a flat byte match
//    (WAV's RIFF/WAVE dual-header, MP4's ftyp box, PE's e_lfanew pointer)
//  - an endMarker strategy so the carving engine knows where an embedded
//    file *stops*, not just where it starts (critical for carving one
//    file out of a larger blob rather than just classifying the whole blob)
//  - a minConfidenceLength: signatures shorter than this many bytes are
//    treated as weak evidence and must be corroborated (see carving.ts)

export interface EndMarkerResult {
  /** Absolute end offset (exclusive) within the buffer, or -1 if not found */
  end: number;
}

export interface FileSignatureDefinition {
  name: string;
  mime: string;
  signatures: number[][];
  offset?: number;
  /** Bytes required in the signature/offset check before this format is even considered */
  customCheck?: (bytes: Uint8Array, startOffset: number) => boolean;
  /** Locate the end of this embedded file starting at `start`. Used for carving. */
  findEnd?: (bytes: Uint8Array, start: number) => EndMarkerResult;
  /** Signatures shorter than this are weak (e.g. 2-byte MZ/BM) and need corroboration */
  weak?: boolean;
  /**
   * Whether this format has a standardized end-of-file marker at all. When
   * false (MP3 stream frames, MP4 atom boxes, WAV's header-declared size,
   * EXE, RAR), a missing findEnd result is expected and not a red flag —
   * the UI should just note the size is unbounded/estimated rather than
   * imply something is wrong with the carve.
   */
  hasStandardFooter: boolean;
}

function indexOfSequence(bytes: Uint8Array, seq: number[], from: number): number {
  outer: for (let i = from; i <= bytes.length - seq.length; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (bytes[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export const FILE_SIGNATURES: Record<string, FileSignatureDefinition> = {
  JPEG: {
    name: 'JPEG Image',
    mime: 'image/jpeg',
    signatures: [[0xff, 0xd8, 0xff]],
    hasStandardFooter: true,
    customCheck: (bytes, start) => {
      // FF D8 FF alone is only 3 bytes and collides fairly often inside
      // high-entropy compressed streams (e.g. inside a PDF full of Flate/
      // DCT-compressed objects). A real JPEG's SOI (FF D8) is ALWAYS
      // immediately followed by another marker segment, so the 4th byte
      // must itself be a valid marker code — practically always in the
      // 0xC0-0xFE range (APPn 0xE0-EF, DQT 0xDB, SOF0/2 0xC0/0xC2,
      // DHT 0xC4, COM 0xFE, etc). A byte like 0x7C here is impossible in
      // a genuine JPEG and is a strong signal of a coincidental match.
      if (bytes.length < start + 4) return false;
      const marker = bytes[start + 3];
      return marker >= 0xc0 && marker <= 0xfe;
    },
    findEnd: (bytes, start) => {
      // JPEG end-of-image marker: FF D9
      const end = indexOfSequence(bytes, [0xff, 0xd9], start + 3);
      return { end: end === -1 ? -1 : end + 2 };
    },
  },
  PNG: {
    name: 'PNG Image',
    mime: 'image/png',
    signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
    hasStandardFooter: true,
    findEnd: (bytes, start) => {
      // IEND chunk: 4-byte length(0000)+"IEND"+4-byte CRC. Search for the
      // literal "IEND" chunk type and include its trailing CRC (4 bytes).
      const iend = [0x49, 0x45, 0x4e, 0x44];
      const idx = indexOfSequence(bytes, iend, start + 8);
      return { end: idx === -1 ? -1 : idx + 4 + 4 };
    },
  },
  GIF: {
    name: 'GIF Image',
    mime: 'image/gif',
    signatures: [[0x47, 0x49, 0x46, 0x38]], // GIF87a / GIF89a
    hasStandardFooter: true,
    findEnd: (bytes, start) => {
      // Standard convention: block terminator 0x00 immediately followed by
      // the GIF trailer byte 0x3B. Falls back to a bare 0x3B if the
      // terminator byte isn't present (spec only strictly guarantees the
      // trailer itself).
      const pairIdx = indexOfSequence(bytes, [0x00, 0x3b], start + 6);
      if (pairIdx !== -1) return { end: pairIdx + 2 };
      const bareIdx = bytes.indexOf(0x3b, start + 6);
      return { end: bareIdx === -1 ? -1 : bareIdx + 1 };
    },
  },
  BMP: {
    name: 'Bitmap Image',
    mime: 'image/bmp',
    signatures: [[0x42, 0x4d]],
    weak: true,
    hasStandardFooter: false, // bounded by declared size field instead, via customCheck/findEnd below
    customCheck: (bytes, start) => {
      // Validate the declared file size field (offset 2, little-endian u32)
      // actually fits within the remaining buffer.
      if (bytes.length < start + 6) return false;
      const declaredSize =
        bytes[start + 2] |
        (bytes[start + 3] << 8) |
        (bytes[start + 4] << 16) |
        (bytes[start + 5] << 24);
      return declaredSize > 14 && start + declaredSize <= bytes.length + 4096; // allow slack
    },
    findEnd: (bytes, start) => {
      if (bytes.length < start + 6) return { end: -1 };
      const declaredSize =
        (bytes[start + 2] |
          (bytes[start + 3] << 8) |
          (bytes[start + 4] << 16) |
          (bytes[start + 5] << 24)) >>>
        0;
      const end = start + declaredSize;
      return { end: end <= bytes.length ? end : -1 };
    },
  },
  PDF: {
    name: 'PDF Document',
    mime: 'application/pdf',
    signatures: [[0x25, 0x50, 0x44, 0x46]], // %PDF
    hasStandardFooter: true,
    findEnd: (bytes, start) => {
      // %%EOF marker
      const marker = [0x25, 0x25, 0x45, 0x4f, 0x46];
      const idx = indexOfSequence(bytes, marker, start + 4);
      return { end: idx === -1 ? -1 : idx + marker.length };
    },
  },
  ZIP: {
    name: 'ZIP Archive / DOCX / XLSX / PPTX',
    mime: 'application/zip',
    signatures: [[0x50, 0x4b, 0x03, 0x04]],
    hasStandardFooter: true,
    findEnd: (bytes, start) => {
      // End of Central Directory record: PK\x05\x06, followed by a fixed
      // 18-byte structure plus a variable-length comment (last 2 bytes = comment length).
      const eocd = [0x50, 0x4b, 0x05, 0x06];
      const idx = indexOfSequence(bytes, eocd, start + 4);
      if (idx === -1) return { end: -1 };
      const commentLenOffset = idx + 20;
      if (commentLenOffset + 2 > bytes.length) return { end: idx + 22 };
      const commentLen = bytes[commentLenOffset] | (bytes[commentLenOffset + 1] << 8);
      return { end: idx + 22 + commentLen };
    },
  },
  TIFF_INTEL: {
    name: 'TIFF Image (Intel)',
    mime: 'image/tiff',
    signatures: [[0x49, 0x49, 0x2a, 0x00]],
    hasStandardFooter: false,
  },
  TIFF_MOTOROLA: {
    name: 'TIFF Image (Motorola)',
    mime: 'image/tiff',
    signatures: [[0x4d, 0x4d, 0x00, 0x2a]],
    hasStandardFooter: false,
  },
  WEBP: {
    name: 'WebP Image',
    mime: 'image/webp',
    signatures: [[0x52, 0x49, 0x46, 0x46]],
    hasStandardFooter: false, // bounded by RIFF chunk size field, not implemented yet
    customCheck: (bytes, start) => {
      if (bytes.length < start + 12) return false;
      return bytes[start + 8] === 0x57 && bytes[start + 9] === 0x45 && bytes[start + 10] === 0x42 && bytes[start + 11] === 0x50;
    },
  },
  WAV: {
    name: 'WAV Audio Container',
    mime: 'audio/wav',
    signatures: [[0x52, 0x49, 0x46, 0x46]],
    hasStandardFooter: false, // size is declared in the RIFF header, not a trailing marker
    customCheck: (bytes, start) => {
      if (bytes.length < start + 12) return false;
      return bytes[start + 8] === 0x57 && bytes[start + 9] === 0x41 && bytes[start + 10] === 0x56 && bytes[start + 11] === 0x45;
    },
  },
  MP3: {
    name: 'MP3 Audio Stream',
    mime: 'audio/mpeg',
    signatures: [
      [0x49, 0x44, 0x33], // ID3 container
      [0xff, 0xfb],
      [0xff, 0xf3],
      [0xff, 0xf2],
    ],
    weak: true, // frame-sync bytes are only 2 bytes and collide easily
    hasStandardFooter: false, // stream just ends, no standard trailer
  },
  MP4_MOV: {
    name: 'MP4 / MOV Video Container',
    mime: 'video/mp4',
    signatures: [],
    hasStandardFooter: false, // uses nested atom/box length fields, not a trailing marker
    customCheck: (bytes, start) => {
      if (bytes.length < start + 8) return false;
      return bytes[start + 4] === 0x66 && bytes[start + 5] === 0x74 && bytes[start + 6] === 0x79 && bytes[start + 7] === 0x70;
    },
  },
  GZIP: {
    name: 'GZIP Compressed Stream',
    mime: 'application/gzip',
    signatures: [[0x1f, 0x8b, 0x08]],
    hasStandardFooter: false,
  },
  SEVEN_ZIP: {
    name: '7-Zip Archive',
    mime: 'application/x-7z-compressed',
    signatures: [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]],
    hasStandardFooter: false,
  },
  RAR: {
    name: 'RAR Archive',
    mime: 'application/vnd.rar',
    signatures: [[0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]],
    hasStandardFooter: false,
  },
  TAR: {
    name: 'TAR Archive',
    mime: 'application/x-tar',
    signatures: [[0x75, 0x73, 0x74, 0x61, 0x72]],
    offset: 257,
    hasStandardFooter: false,
  },
  ELF: {
    name: 'Linux Executable (ELF)',
    mime: 'application/x-executable',
    signatures: [[0x7f, 0x45, 0x4c, 0x46]],
    hasStandardFooter: false,
  },
  PE: {
    name: 'Windows Executable (PE / DOS MZ)',
    mime: 'application/vnd.microsoft.portable-executable',
    signatures: [[0x4d, 0x5a]],
    weak: true, // "MZ" is only 2 bytes; validate the PE header pointer too
    hasStandardFooter: false,
    customCheck: (bytes, start) => {
      if (bytes.length < start + 0x40) return false;
      const e_lfanew =
        bytes[start + 0x3c] |
        (bytes[start + 0x3d] << 8) |
        (bytes[start + 0x3e] << 16) |
        (bytes[start + 0x3f] << 24);
      const peOffset = start + e_lfanew;
      if (e_lfanew <= 0 || peOffset + 4 > bytes.length) return false;
      return (
        bytes[peOffset] === 0x50 &&
        bytes[peOffset + 1] === 0x45 &&
        bytes[peOffset + 2] === 0x00 &&
        bytes[peOffset + 3] === 0x00
      );
    },
  },
  SVG: {
    // Text-based, no fixed magic number in the traditional sense — but the
    // literal ASCII bytes "<svg" are a reliable enough anchor once
    // corroborated by requiring the byte right after it to plausibly end
    // a tag name (not just any element name that happens to start with
    // "svg", like a hypothetical custom "<svgFoo>" element).
    name: 'SVG Image (XML)',
    mime: 'image/svg+xml',
    signatures: [[0x3c, 0x73, 0x76, 0x67]], // "<svg"
    hasStandardFooter: true,
    customCheck: (bytes, start) => {
      if (bytes.length < start + 5) return false;
      const b = bytes[start + 4];
      // whitespace, '>', or '/' (self-closing) are the only bytes that can
      // legally follow a complete "svg" tag name in valid XML.
      return b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0x3e || b === 0x2f;
    },
    findEnd: (bytes, start) => {
      // First find the end of the opening tag itself — the first
      // unescaped '>' after "<svg". XML attribute values must escape a
      // literal '>' as &gt;, so a bare '>' reliably closes the tag.
      const openTagEnd = bytes.indexOf(0x3e, start + 4); // '>'
      if (openTagEnd === -1) return { end: -1 };

      // Self-closing root element: "<svg .../>" — nothing more to find.
      if (bytes[openTagEnd - 1] === 0x2f) {
        return { end: openTagEnd + 1 };
      }

      // Otherwise, find the matching "</svg>" closing tag.
      const closeTag = [0x3c, 0x2f, 0x73, 0x76, 0x67, 0x3e]; // "</svg>"
      const idx = indexOfSequence(bytes, closeTag, openTagEnd);
      return { end: idx === -1 ? -1 : idx + closeTag.length };
    },
  },
};

/** Signatures eligible for the byte-level sliding-window carving scan. */
export const CARVABLE_KEYS = Object.keys(FILE_SIGNATURES).filter(
  (k) => FILE_SIGNATURES[k].signatures.length > 0 || FILE_SIGNATURES[k].customCheck
);
