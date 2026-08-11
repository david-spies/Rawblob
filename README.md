![Rawblob](assets/rawblob-banner.svg)

![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=0b1120)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)
![Web Workers](https://img.shields.io/badge/Parsing-Web_Workers-E8A33D?style=flat-square)
![Client-Side Only](https://img.shields.io/badge/Processing-100%25_Client--Side-4FB4A0?style=flat-square)
![Zero Server Storage](https://img.shields.io/badge/Server_Storage-Zero-4FB4A0?style=flat-square)
![Forensic File Carving](https://img.shields.io/badge/Forensic-File_Carving-E2645C?style=flat-square)
![Node](https://img.shields.io/badge/Node.js-%3E%3D18-339933?style=flat-square&logo=node.js&logoColor=white)
![Status](https://img.shields.io/badge/Status-Active_Development-E8A33D?style=flat-square)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)

# Rawblob

**Client-side forensic file carving & reconstruction.**

Rawblob scans raw byte streams and documents for files hidden inside them —
whether embedded directly in a binary blob or encoded as Base64 inside a
text document — and reconstructs them for inspection, right in your
browser. Nothing is uploaded or stored server-side: parsing, carving,
entropy analysis, and decoding all run locally via Web Workers.

## What it does

- **Carves embedded files out of raw binary blobs.** Rather than only
  classifying what a whole file *is*, Rawblob scans every offset of a
  buffer for known file signatures, so a file concatenated or hidden inside
  another file is found and extracted independently — not just the
  outermost one.
- **Validates both header and footer before trusting a match.** A short
  header alone (2–4 bytes) can coincidentally occur inside high-entropy
  compressed data, especially in containers like PDFs that are full of
  Flate/DCT-compressed streams. Rawblob corroborates structurally where a
  format allows it (e.g. JPEG requires a real marker code immediately
  after the SOI bytes, not just any byte) and always reports whether a
  standard end-of-file marker was actually located — see **Signature
  confidence** below.
- **Detects and decodes Base64-encoded payloads** embedded in document
  text, filtering out incidental alphanumeric noise (hashes, tokens, UUIDs)
  so you see genuine embedded files and plaintext, not everything that
  happens to be base64-shaped.
- **Scores every payload with Shannon entropy** to flag likely encryption
  or compression, with confidence tiers so small samples aren't given
  false authority.
- **Manual Signature Search.** Search the loaded buffer directly for a
  byte pattern in hex, ASCII, or decimal — useful for verifying a specific
  signature, chasing a hunch, or finding something outside the built-in
  format database entirely.
- **Never executes or live-renders anything unsafe.** Executables are
  hex-dumped and offered only as a guarded, non-executable download.
  Markup formats (SVG/HTML) that could carry active code are rendered only
  inside a script-disabled sandboxed frame.

## Directory structure

```
rawblob/
├── app/
│   ├── layout.tsx                # Root layout, metadata, global styles
│   ├── page.tsx                  # Home page — renders <Dashboard />
│   └── globals.css               # Design tokens, fonts, focus/motion rules
├── components/
│   ├── Dashboard.tsx             # Top-level composition + session state
│   ├── DropZone.tsx              # Drag-and-drop ingest, format/size validation
│   ├── TelemetryMatrix.tsx       # Real-time results table
│   ├── ReconstructionCanvas.tsx  # Split-screen preview + hex inspector +
│   │                             #   matched header/footer bytes
│   ├── PatternSearchPanel.tsx    # Manual hex/ASCII/decimal signature search
│   ├── ByteRuler.tsx             # Offset ruler (full + mini position-bar)
│   └── StatusBadges.tsx          # Entropy / signature / footer-confidence /
│                                 #   render-mode badges
├── lib/
│   ├── workers/
│   │   ├── signatures.ts         # File signature DB (magic numbers, offsets,
│   │   │                         #   structural checks, end markers,
│   │   │                         #   hasStandardFooter per format)
│   │   ├── carving.ts            # Sliding-window carving engine + entropy +
│   │   │                         #   header/footer hex capture
│   │   ├── base64scanner.ts      # Confidence-scored Base64 payload detector
│   │   ├── patternSearch.ts      # Hex/ASCII/decimal query parsing + buffer search
│   │   └── rawblob.worker.ts     # Worker entry point — ties it all together,
│   │                             #   retains the analyzed buffer for search
│   └── hooks/
│       └── useRawblobWorker.ts   # Worker lifecycle, Object URL tracking/cleanup,
│                                 #   safe render-mode classification, search calls
├── assets/
│   └── rawblob-banner.svg        # Animated README banner (SMIL, GitHub-safe)
├── test/
│   ├── harness.ts                # Engine tests: carving, entropy, Base64 gating,
│   │                             #   header/footer validation, pattern search
│   ├── dom-smoke.tsx             # Component render smoke test
│   └── dom-smoke.setup.cjs       # jsdom bootstrap required to run the smoke test
├── postcss.config.js             # Tailwind v4 PostCSS plugin wiring
├── tsconfig.json
├── package.json
└── README.md
```

## Quick start

**Requirements:** Node.js 18+ and npm.

```bash
# 1. Install dependencies
npm install

# 2. Run the dev server
npm run dev

# 3. Open the dashboard
# http://localhost:3000
```

To build for production:

```bash
npm run build
npm run start
```

To run the engine test suite (carving accuracy, entropy sanity, Base64
false-positive/true-positive gating, header/footer validation, pattern
search parsing):

```bash
npx esbuild test/harness.ts --bundle --platform=node --format=cjs --outfile=/tmp/harness.cjs && node /tmp/harness.cjs
```

To run the component render smoke test (requires `jsdom` and
`esbuild-register` as dev dependencies):

```bash
node -r ./test/dom-smoke.setup.cjs test/dom-smoke.tsx
```

If `next`, `framer-motion`, or React aren't already present in your
`package.json`, add them before running the dev server:

```bash
npm install next react react-dom framer-motion
```

**Note on Tailwind:** this project uses **Tailwind CSS v4**, which is
configured natively in CSS (`app/globals.css` — `@import "tailwindcss";`
plus an `@theme` block) rather than a `tailwind.config.ts` file, and uses
the `@tailwindcss/postcss` PostCSS plugin instead of the old `tailwindcss`
plugin + `autoprefixer` pairing from v3. If you see a `Parsing CSS source
code failed` / `Unknown at rule: @tailwind` warning, it means the classic
v3-style `@tailwind base/components/utilities` directives are present
somewhere instead of the v4 `@import "tailwindcss";` syntax — check
`app/globals.css` matches the version in this repo.

## How it works

1. **Drop or select a file** (TXT, PDF, DOCX, RTF, MD, CSV, LOG, JSON — up
   to 15MB). The size and format are validated client-side before anything
   is read.
2. The file's bytes are handed to a **Web Worker** so the UI thread never
   blocks, even on a full 15MB scan. The worker retains the buffer in
   memory afterward so Manual Signature Search can query it later without
   re-reading the file.
3. The worker runs a sliding-window carving pass across the entire byte
   range for known file signatures (images, archives, executables,
   audio/video containers). For each hit:
   - **Header validation** — where a format allows it, more than a raw
     byte match is required. JPEG, for example, requires the byte
     immediately after the SOI marker to be a real marker code
     (`0xC0`–`0xFE`), not an arbitrary byte — this is what rejects
     coincidental 3-byte matches that turn up inside compressed streams
     (a real false positive found during testing against a live PDF: `FF
     D8 FF` occurring by chance inside Flate-compressed content, with a
     structurally invalid 4th byte).
   - **Footer/end-marker search** — bounding the carve with a
     format-appropriate end marker (PNG's `IEND` chunk + CRC, PDF's
     `%%EOF`, ZIP's End-of-Central-Directory record, GIF's `00 3B`
     trailer with a bare-`3B` fallback, JPEG's `FF D9`). Whether this
     search actually found a real footer — or fell back to "rest of the
     buffer" — is preserved and shown, not hidden.
4. Every detected payload appears as a row in the **Telemetry Matrix**,
   with its signature, a footer-confidence badge, entropy score, size, and
   a position indicator showing exactly where it sits in the original
   buffer.
5. Selecting a row opens it in the **Reconstruction Canvas**: the matched
   header and footer bytes in hex (so a carve can be manually verified,
   not just trusted), a live preview (image, text, or sandboxed markup)
   alongside a full hex dump, and a one-click, non-executable download.
6. **Manual Signature Search** (collapsed by default, below the canvas)
   lets you query the loaded buffer directly for a hex, ASCII, or decimal
   byte pattern — independent of the automatic carving pass. Selecting a
   result jumps to it in the canvas if it falls inside an already-carved
   file.

## Signature confidence

Every carved file is labeled with how confident its boundaries are, shown
as a badge next to its signature name in both the Telemetry Matrix and the
Reconstruction Canvas:

- **`footer confirmed`** (teal) — a real end-of-file marker was located
  for this format; the offset range is a fact, not an estimate.
- **`unbounded`** (red) — this format has a standard footer, but it
  couldn't be found; the end offset falls back to the rest of the buffer
  and should be treated as an estimate, not a confirmed boundary.
- **`no std. footer`** (neutral) — this format has no standardized
  trailing marker at all (MP3 stream frames, MP4 atom boxes, WAV's
  header-declared size, EXE, RAR, 7-Zip, GZIP, TAR, TIFF, WebP) — the size
  shown is derived from format-specific structure where possible, and a
  missing footer here is expected, not a red flag.
- **`weak sig`** (amber) — the header itself is short or easily-collided
  (e.g. `MZ` for PE, `BM` for BMP); these formats are corroborated with an
  additional structural check (PE walks its actual `e_lfanew` → `PE\0\0`
  header pointer; BMP validates its declared file-size field) but are
  still flagged so a hit isn't presented with unearned confidence.

## Usability notes

- **Everything stays local.** No network request is made with file
  content at any point — the worker never has network access, and no
  server endpoint exists to receive uploaded bytes.
- **Header and footer bytes are always shown, not just claimed.** The
  Reconstruction Canvas displays the actual matched header and footer hex
  for the selected payload, so a carve can be independently verified
  rather than taken on faith.
- **Entropy is contextualized, not just reported.** Low-sample readings
  are marked `low-n` rather than presented with false precision, and a
  payload whose entropy doesn't match what's expected for its claimed type
  is flagged `inconsistent` — itself a useful forensic signal. Container
  formats with legitimately huge entropy variance (PDF, TAR) are given
  wide expected ranges so normal files — like a PDF embedding a compressed
  image — aren't falsely flagged.
- **Executable content is inert by design.** PE and ELF payloads are never
  rendered or given a live preview URL; they can only be hex-inspected or
  downloaded as a generic `.bin` file, which won't auto-execute on save.
- **Markup is sandboxed.** SVG and HTML-shaped payloads render inside an
  `<iframe sandbox="">` with scripting disabled, since these formats can
  carry executable content of their own.
- **Manual search results respect the same offset system as carving** —
  clicking a search hit jumps to its containing carved file in the canvas
  when one exists, keeping the two inspection modes connected rather than
  siloed.
- **Keyboard accessible throughout.** The drop zone, every Telemetry
  Matrix row, and the search panel are focusable and operable via keyboard
  (Enter/Space), with a visible focus ring.
- **Reduced motion respected.** Users with `prefers-reduced-motion` set get
  instant state changes instead of the drop-zone and scan animations.

## Design system

- **Palette:** dark graphite base with three semantic accents — amber
  (active/primary), teal (verified/consistent), red (high-entropy/danger)
  — used functionally for forensic triage rather than decoratively.
- **Type:** IBM Plex Sans for UI chrome, IBM Plex Mono for offsets, hex,
  and all byte-level data — a family designed for technical readouts.
- **Signature element:** the **byte ruler** — a tick-marked offset strip
  shown above the Reconstruction Canvas and as a compact position-bar per
  Telemetry Matrix row, so the buffer position of every payload is always
  visible, not buried in a table column. The same motif carries into
  `assets/rawblob-banner.svg`, the animated README banner, so the app and
  its branding read as one product.

## Known limitations / not yet wired

- PDF (`pdfjs-dist`) and DOCX (`mammoth.js`) text extraction are not yet
  connected to `analyzeText` — the worker currently accepts raw text or a
  raw buffer directly; hooking up per-format extraction is the next step
  before non-plaintext document types can be scanned end-to-end for
  embedded Base64 content specifically (raw-buffer carving already works
  against PDFs today, including finding files embedded within them).
- SVG signature detection is defined in `signatures.ts` but not yet
  actively matched (SVG has no fixed magic number and needs a lightweight
  XML-prolog sniff) — the `sandboxed` render path is ready for it.
- WebP, TIFF, and a few other RIFF/chunked formats are marked
  `hasStandardFooter: false` and carve to the rest of the buffer rather
  than parsing their internal chunk/size fields for a precise bound —
  functionally correct for classification, but their reported byte length
  should be read as an upper bound, not exact, until that parsing is added.
- Very large extracted text blobs are scanned in a single synchronous pass
  inside the worker; fine at the current 15MB ceiling, but worth chunking
  with a match cap if that ceiling is ever raised.
- Manual Signature Search runs against whatever buffer was last analyzed;
  it has no awareness of Base64-decoded sub-buffers once text extraction
  is wired up, so it will need to gain a "search scope" selector at that
  point.
