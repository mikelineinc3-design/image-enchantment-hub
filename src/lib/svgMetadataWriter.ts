// SVG Metadata Writer
// Embeds microstock metadata (Title, Description, Keywords, Copyright, Author)
// into an SVG file using <title>, <desc>, and an RDF/Dublin Core <metadata>
// block inside the root <svg> element. Returns a data URL suitable for
// direct download as a .svg file (image/svg+xml).

import { IptcXmpData } from './iptcXmpWriter';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunkSize)) as number[]
    );
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function buildSvgMetadataBlock(data: IptcXmpData): string {
  const keywordTags = data.keywords
    .map((k) => `        <rdf:li>${escapeXml(k)}</rdf:li>`)
    .join('\n');
  return `  <title>${escapeXml(data.title)}</title>
  <desc>${escapeXml(data.description)}</desc>
  <metadata>
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
             xmlns:dc="http://purl.org/dc/elements/1.1/"
             xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
             xmlns:xmp="http://ns.adobe.com/xap/1.0/">
      <rdf:Description rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(data.title)}</rdf:li></rdf:Alt></dc:title>
        <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(data.description)}</rdf:li></rdf:Alt></dc:description>
        <dc:subject><rdf:Bag>
${keywordTags}
        </rdf:Bag></dc:subject>
        <dc:creator><rdf:Seq><rdf:li>${escapeXml(data.author)}</rdf:li></rdf:Seq></dc:creator>
        <dc:rights><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(data.copyright || '')}</rdf:li></rdf:Alt></dc:rights>
        <xmpRights:Marked>True</xmpRights:Marked>
        <xmpRights:UsageTerms><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(data.rights || '')}</rdf:li></rdf:Alt></xmpRights:UsageTerms>
        <xmp:CreatorTool>${escapeXml(data.software)}</xmp:CreatorTool>
      </rdf:Description>
    </rdf:RDF>
  </metadata>
`;
}

// Strip ONLY the contiguous run of <title>/<desc>/<metadata> elements that
// appear immediately after the opening <svg> tag. Anything nested inside the
// artwork (e.g. accessibility <title> on shapes) is left untouched so the
// vector structure and UTF-8 content stay byte-intact.
function stripLeadingMetadata(svgInner: string): string {
  const leadingRe = /^(\s*<(?:title|desc|metadata)\b[\s\S]*?<\/(?:title|desc|metadata)>\s*)+/i;
  return svgInner.replace(leadingRe, '');
}

export function embedMetadataIntoSvgText(svgText: string, data: IptcXmpData): string {
  const metadataBlock = buildSvgMetadataBlock(data);

  // Find the opening <svg ...> tag and insert metadata right after it.
  const svgOpenMatch = svgText.match(/<svg\b[^>]*>/i);
  if (svgOpenMatch && typeof svgOpenMatch.index === 'number') {
    const tag = svgOpenMatch[0];
    const insertAt = svgOpenMatch.index + tag.length;
    const before = svgText.slice(0, insertAt);
    const after = stripLeadingMetadata(svgText.slice(insertAt));
    return before + '\n' + metadataBlock + after;
  }

  // No <svg> tag found — wrap minimally so file is still valid.
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg">\n' +
    metadataBlock +
    svgText +
    '\n</svg>'
  );
}

// Public entry point: accepts an SVG data URL (base64 or url-encoded) and
// returns a new data URL with metadata embedded, MIME image/svg+xml.
export function embedMetadataIntoSvgDataUrl(svgDataUrl: string, data: IptcXmpData): string {
  try {
    const commaIdx = svgDataUrl.indexOf(',');
    if (commaIdx === -1) return svgDataUrl;
    const header = svgDataUrl.slice(0, commaIdx);
    const payload = svgDataUrl.slice(commaIdx + 1);

    let svgText: string;
    if (/;base64/i.test(header)) {
      const bytes = base64ToBytes(payload);
      svgText = new TextDecoder('utf-8').decode(bytes);
    } else {
      svgText = decodeURIComponent(payload);
    }

    const updated = embedMetadataIntoSvgText(svgText, data);
    const updatedBytes = new TextEncoder().encode(updated);
    return 'data:image/svg+xml;base64,' + bytesToBase64(updatedBytes);
  } catch (err) {
    console.error('Failed to embed SVG metadata', err);
    return svgDataUrl;
  }
}
