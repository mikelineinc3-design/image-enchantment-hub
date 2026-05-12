// IPTC/XMP Metadata Writer for Microstock Compatibility
// Embeds dc:title, dc:description, dc:subject into image metadata

export interface IptcXmpData {
  title: string;
  description: string;
  keywords: string[];
  author: string;
  software: string;
  copyright?: string;
}

// Create XMP packet with Dublin Core metadata
function createXmpPacket(data: IptcXmpData): string {
  const keywordTags = data.keywords
    .map(k => `          <rdf:li>${escapeXml(k)}</rdf:li>`)
    .join('\n');

  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:title>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(data.title)}</rdf:li>
        </rdf:Alt>
      </dc:title>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang="x-default">${escapeXml(data.description)}</rdf:li>
        </rdf:Alt>
      </dc:description>
      <dc:subject>
        <rdf:Bag>
${keywordTags}
        </rdf:Bag>
      </dc:subject>
      <dc:creator>
        <rdf:Seq>
          <rdf:li>${escapeXml(data.author)}</rdf:li>
        </rdf:Seq>
      </dc:creator>
      <xmp:CreatorTool>${escapeXml(data.software)}</xmp:CreatorTool>
      <photoshop:Credit>${escapeXml(data.author)}</photoshop:Credit>
      <photoshop:Source>${escapeXml(data.author)}</photoshop:Source>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Convert base64 to Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Convert Uint8Array to base64
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Find position to insert XMP APP1 segment.
// IMPORTANT: must come AFTER any existing EXIF APP1, so EXIF readers that only
// read the first APP1 segment still see the EXIF block intact.
function findXmpInsertPosition(data: Uint8Array): number {
  let pos = 2; // Skip SOI marker (0xFFD8)
  while (pos < data.length - 4) {
    if (data[pos] !== 0xFF) break;
    const marker = data[pos + 1];
    // Stop at SOS (start of scan) or EOI - insert before image data
    if (marker === 0xDA || marker === 0xD9) return pos;
    // Standalone markers without length payload
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      pos += 2;
      continue;
    }
    const length = (data[pos + 2] << 8) | data[pos + 3];
    // Skip past this segment (including any existing APP1/EXIF) so XMP lands after it
    pos += 2 + length;
  }
  return pos;
}

// Embed XMP into JPEG
export function embedXmpIntoJpeg(jpegDataUrl: string, xmpData: IptcXmpData): string {
  try {
    // Extract base64 data
    const base64Match = jpegDataUrl.match(/^data:image\/jpeg;base64,(.+)$/);
    if (!base64Match) return jpegDataUrl;

    const imageData = base64ToUint8Array(base64Match[1]);
    
    // Create XMP packet
    const xmpPacket = createXmpPacket(xmpData);
    const xmpBytes = new TextEncoder().encode(xmpPacket);
    
    // XMP APP1 header: "http://ns.adobe.com/xap/1.0/\0"
    const xmpHeader = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0');
    
    // Calculate segment length
    const segmentLength = 2 + xmpHeader.length + xmpBytes.length;
    
    // Find position to insert
    const insertPos = findXmpInsertPosition(imageData);
    
    // Build new image
    const newImage = new Uint8Array(imageData.length + 4 + segmentLength);
    
    // Copy data before insert position
    newImage.set(imageData.slice(0, insertPos), 0);
    
    // Insert APP1 marker
    let offset = insertPos;
    newImage[offset++] = 0xFF;
    newImage[offset++] = 0xE1;
    newImage[offset++] = (segmentLength >> 8) & 0xFF;
    newImage[offset++] = segmentLength & 0xFF;
    
    // Insert XMP header and data
    newImage.set(xmpHeader, offset);
    offset += xmpHeader.length;
    newImage.set(xmpBytes, offset);
    offset += xmpBytes.length;
    
    // Copy remaining data
    newImage.set(imageData.slice(insertPos), offset);
    
    return 'data:image/jpeg;base64,' + uint8ArrayToBase64(newImage);
  } catch (error) {
    console.error('Error embedding XMP:', error);
    return jpegDataUrl;
  }
}

// Sanitize title for microstock (max 195 chars, only letters, numbers, spaces, commas, periods, hyphens)
export function sanitizeTitle(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s,.\-]/g, '') // Only allow alphanumeric, spaces, commas, periods, hyphens
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim()
    .slice(0, 195);
}

// Sanitize keywords (max 45 keywords, only letters, numbers, spaces, hyphens - NO special characters)
export function sanitizeKeywords(keywords: string): string[] {
  return keywords
    .split(',')
    .map(k => k
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s\-]/g, '') // Only allow lowercase letters, numbers, spaces, hyphens
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
    )
    .filter(k => k.length > 0 && k.length <= 50) // Filter empty and overly long keywords
    .slice(0, 45);
}
