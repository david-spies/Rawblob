import { carveEmbeddedFiles, classifyBuffer, calculateShannonEntropy } from '../lib/workers/carving';
import { scanAndDecodeBase64 } from '../lib/workers/base64scanner';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
}

// --- Test 1: A minimal valid PNG followed immediately by a minimal ZIP,
// concatenated into a single blob (the exact scenario the reviewer flagged
// as broken in the original offset-0-only implementation).
function buildMinimalPng(): number[] {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // IHDR chunk (fake length/crc, doesn't need to be valid for our carving test)
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(13).fill(0), 0, 0, 0, 0];
  // IDAT chunk
  const idat = [0, 0, 0, 4, 0x49, 0x44, 0x41, 0x54, 1, 2, 3, 4, 0, 0, 0, 0];
  // IEND chunk
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  return [...sig, ...ihdr, ...idat, ...iend];
}

function buildMinimalZipTail(): number[] {
  // local file header
  const local = [0x50, 0x4b, 0x03, 0x04, ...new Array(26).fill(0)];
  // End of Central Directory record (minimum 22 bytes, no comment)
  const eocd = [0x50, 0x4b, 0x05, 0x06, ...new Array(16).fill(0), 0, 0];
  return [...local, ...eocd];
}

const combined = new Uint8Array([...buildMinimalPng(), ...buildMinimalZipTail()]);
const carved = carveEmbeddedFiles(combined);

assert(carved.length === 2, `expected 2 carved files from concatenated PNG+ZIP blob, got ${carved.length}`);
assert(carved.some((c) => c.type === 'PNG'), 'PNG detected within concatenated blob');
assert(carved.some((c) => c.type === 'ZIP'), 'ZIP detected within concatenated blob (this is what offset-0-only classification would MISS)');

const png = carved.find((c) => c.type === 'PNG')!;
assert(png.startOffset === 0, `PNG start offset should be 0, got ${png.startOffset}`);
assert(png.endOffset === buildMinimalPng().length, `PNG end offset should bound just the PNG, got ${png.endOffset} vs expected ${buildMinimalPng().length}`);

const zip = carved.find((c) => c.type === 'ZIP')!;
assert(zip.startOffset === buildMinimalPng().length, `ZIP should start right after the PNG ends, got ${zip.startOffset}`);

// --- Test 2: top-level classification of a lone PDF
const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, ...Array(20).fill(0x41), 0x25, 0x25, 0x45, 0x4f, 0x46]);
const pdfClass = classifyBuffer(pdfBytes);
assert(pdfClass.type === 'PDF', `PDF classified correctly, got ${pdfClass.type}`);

// --- Test 3: entropy sanity — all-zero buffer should have entropy 0
const zeroBuf = new Uint8Array(1000);
assert(calculateShannonEntropy(zeroBuf) === 0, `all-zero buffer has entropy 0, got ${calculateShannonEntropy(zeroBuf)}`);

// --- Test 4: high-entropy random buffer should read close to 8.0
const randomBuf = new Uint8Array(4096);
for (let i = 0; i < randomBuf.length; i++) randomBuf[i] = Math.floor(Math.random() * 256);
const randEntropy = calculateShannonEntropy(randomBuf);
assert(randEntropy > 7.5, `random buffer entropy should be near 8.0, got ${randEntropy}`);

// --- Test 5: Base64 scanner should REJECT a plausible-length hash/token
// (the false-positive case the reviewer specifically called out)
const fakeToken = Buffer.from('a'.repeat(48)).toString('base64'); // decodes to low-entropy non-printable-ish repeated text actually 'a' IS printable...
// Use a hex-like hash string instead - random hex chars, still base64-charset-valid
const hashLike = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85e3b0c44298fc1c14';
const textWithHash = `The commit hash was ${hashLike} for this build.`;
const hashHits = scanAndDecodeBase64(textWithHash);
assert(hashHits.length === 0, `plain hex hash string should NOT be flagged as a payload, got ${hashHits.length} hits`);

// --- Test 6: Base64 scanner SHOULD catch a real embedded PNG
const pngBytes = new Uint8Array(buildMinimalPng());
const pngB64 = Buffer.from(pngBytes).toString('base64');
const textWithPng = `Here is some embedded data: ${pngB64} -- end of message.`;
const pngHits = scanAndDecodeBase64(textWithPng);
assert(pngHits.length === 1, `embedded base64 PNG should be detected, got ${pngHits.length} hits`);
if (pngHits.length === 1) {
  assert(pngHits[0].fileSignature.type === 'PNG', `detected payload correctly classified as PNG, got ${pngHits[0].fileSignature.type}`);
  assert(pngHits[0].reason === 'signature-match', `detection reason should be signature-match, got ${pngHits[0].reason}`);
}

// --- Test 7: Base64 scanner SHOULD catch substantial embedded plaintext
const secretText = 'username=admin\npassword=SuperSecret123\nhost=internal.db.local\n'.repeat(2);
const secretB64 = Buffer.from(secretText, 'utf-8').toString('base64');
const textWithSecret = `config blob: ${secretB64}`;
const textHits = scanAndDecodeBase64(textWithSecret);
assert(textHits.length === 1, `embedded plaintext config should be detected, got ${textHits.length} hits`);
if (textHits.length === 1) {
  assert(textHits[0].reason === 'printable-text', `detection reason should be printable-text, got ${textHits[0].reason}`);
}

console.log('\nDone.');

// --- Test 8 (regression): a PDF whose overall entropy is pushed near 8.0
// by an embedded high-entropy stream (e.g. a compressed/embedded image)
// should NOT be flagged 'inconsistent' — PDF is a container format with
// legitimately huge entropy variance. This is the exact scenario reported
// against a real-world 1.4MB PDF containing an embedded JPEG.
function buildPdfWithEmbeddedHighEntropyStream(): Uint8Array {
  const header = [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]; // %PDF-1.4
  const randomStream = new Array(2000).fill(0).map(() => Math.floor(Math.random() * 256));
  const eof = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
  return new Uint8Array([...header, ...randomStream, ...eof]);
}

const pdfWithStream = buildPdfWithEmbeddedHighEntropyStream();
const pdfCarved = carveEmbeddedFiles(pdfWithStream);
const pdfHit = pdfCarved.find((c) => c.type === 'PDF');
assert(!!pdfHit, 'PDF with embedded high-entropy stream is still carved');
if (pdfHit) {
  assert(pdfHit.entropyScore > 7.0, `PDF entropy should read high given the embedded random stream, got ${pdfHit.entropyScore}`);
  assert(pdfHit.entropyConsistent === true, `high-entropy PDF should NOT be flagged inconsistent (regression check), got entropyConsistent=${pdfHit.entropyConsistent}`);
}

console.log('\nAll done.');
