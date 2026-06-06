// PNG Metadata Writer — embeds Title/Description/Keywords/Author/Software via
// tEXt chunks and a full XMP packet via an iTXt chunk so microstock readers
// (Adobe Bridge, Shutterstock ingest, exiftool) can read PNG metadata.

import { IptcXmpData } from './iptcXmpWriter';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// CRC32 (PNG polynomial)
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as number[]);
  }
  return btoa(s);
}

function latin1Encode(s: string): Uint8Array {
  // Strip non-Latin-1 chars for tEXt safety
  const safe = s.replace(/[^\x00-\xff]/g, '');
  const out = new Uint8Array(safe.length);
  for (let i = 0; i < safe.length; i++) out[i] = safe.charCodeAt(i) & 0xff;
  return out;
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(8 + data.length + 4);
  // length
  const len = data.length;
  chunk[0] = (len >>> 24) & 0xff;
  chunk[1] = (len >>> 16) & 0xff;
  chunk[2] = (len >>> 8) & 0xff;
  chunk[3] = len & 0xff;
  // type
  chunk.set(typeBytes, 4);
  // data
  chunk.set(data, 8);
  // crc over type+data
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  const crc = crc32(crcInput);
  const off = 8 + data.length;
  chunk[off] = (crc >>> 24) & 0xff;
  chunk[off + 1] = (crc >>> 16) & 0xff;
  chunk[off + 2] = (crc >>> 8) & 0xff;
  chunk[off + 3] = crc & 0xff;
  return chunk;
}

function buildTextChunk(keyword: string, text: string): Uint8Array {
  const k = latin1Encode(keyword);
  const t = latin1Encode(text);
  const data = new Uint8Array(k.length + 1 + t.length);
  data.set(k, 0);
  data[k.length] = 0;
  data.set(t, k.length + 1);
  return buildChunk('tEXt', data);
}

function buildItxtXmpChunk(xmp: string): Uint8Array {
  const keyword = new TextEncoder().encode('XML:com.adobe.xmp');
  const xmpBytes = new TextEncoder().encode(xmp);
  // keyword \0 compressionFlag(0) compressionMethod(0) languageTag \0 translatedKeyword \0 text
  const data = new Uint8Array(keyword.length + 1 + 1 + 1 + 0 + 1 + 0 + 1 + xmpBytes.length);
  let o = 0;
  data.set(keyword, o); o += keyword.length;
  data[o++] = 0; // null after keyword
  data[o++] = 0; // compression flag (uncompressed)
  data[o++] = 0; // compression method
  data[o++] = 0; // null after empty language tag
  data[o++] = 0; // null after empty translated keyword
  data.set(xmpBytes, o);
  return buildChunk('iTXt', data);
}

function createXmpPacket(d: IptcXmpData): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
     .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const kw = d.keywords.map(k => `          <rdf:li>${esc(k)}</rdf:li>`).join('\n');
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(d.title)}</rdf:li></rdf:Alt></dc:title>
      <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${esc(d.description)}</rdf:li></rdf:Alt></dc:description>
      <dc:subject><rdf:Bag>
${kw}
      </rdf:Bag></dc:subject>
      <dc:creator><rdf:Seq><rdf:li>${esc(d.author)}</rdf:li></rdf:Seq></dc:creator>
      <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${esc(d.copyright || '')}</rdf:li></rdf:Alt></dc:rights>
      <xmpRights:Marked>True</xmpRights:Marked>
      <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${esc(d.rights || '')}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
      <xmp:CreatorTool>${esc(d.software)}</xmp:CreatorTool>
      <photoshop:Credit>${esc(d.author)}</photoshop:Credit>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export function embedMetadataIntoPng(pngDataUrl: string, data: IptcXmpData): string {
  try {
    const m = pngDataUrl.match(/^data:image\/png;base64,(.+)$/);
    if (!m) return pngDataUrl;
    const bytes = base64ToUint8Array(m[1]);

    // Verify signature
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) return pngDataUrl;
    }

    // Parse chunks to find insertion point right after IHDR and strip any
    // existing tEXt/iTXt chunks we plan to write so we don't end up with dupes.
    const keepChunks: Uint8Array[] = [];
    let ihdrEnd = -1;
    let pos = 8;
    while (pos < bytes.length) {
      const length =
        (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      const chunkEnd = pos + 8 + length + 4;
      const chunk = bytes.slice(pos, chunkEnd);
      if (type === 'IHDR') {
        ihdrEnd = keepChunks.length + 1;
        keepChunks.push(chunk);
      } else if (type === 'tEXt' || type === 'iTXt') {
        // Drop any existing metadata chunks we're about to rewrite
        const nullIdx = chunk.indexOf(0, 8);
        const keyword =
          nullIdx > 8
            ? new TextDecoder('latin1').decode(chunk.slice(8, nullIdx))
            : '';
        const skip = ['Title', 'Description', 'Keywords', 'Author', 'Copyright', 'Rights', 'Software', 'XML:com.adobe.xmp'];
        if (!skip.includes(keyword)) keepChunks.push(chunk);
      } else {
        keepChunks.push(chunk);
      }
      pos = chunkEnd;
      if (type === 'IEND') break;
    }

    if (ihdrEnd < 0) return pngDataUrl;

    // Build new metadata chunks
    const metaChunks: Uint8Array[] = [
      buildTextChunk('Title', data.title),
      buildTextChunk('Description', data.description),
      buildTextChunk('Keywords', data.keywords.join('; ')),
      buildTextChunk('Author', data.author),
      buildTextChunk('Copyright', data.copyright || ''),
      buildTextChunk('Rights', data.rights || ''),
      buildTextChunk('Software', data.software),
      buildItxtXmpChunk(createXmpPacket(data)),
    ];

    // Stitch: signature + IHDR + meta chunks + remaining chunks
    const head = keepChunks.slice(0, ihdrEnd);
    const tail = keepChunks.slice(ihdrEnd);
    const parts: Uint8Array[] = [new Uint8Array(PNG_SIGNATURE), ...head, ...metaChunks, ...tail];
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return 'data:image/png;base64,' + uint8ArrayToBase64(out);
  } catch (err) {
    console.error('Error embedding PNG metadata:', err);
    return pngDataUrl;
  }
}
