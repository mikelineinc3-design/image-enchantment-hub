// EPS (PostScript) Metadata Writer
// Embeds Title, Description, Keywords, Copyright, Author into an EPS file
// using both DSC comments and an XMP packet, then returns a data URL
// suitable for direct download as a .eps file.

import { IptcXmpData } from './iptcXmpWriter';

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapePsComment(str: string): string {
  // DSC comments must be single-line plain ASCII-safe text
  return str.replace(/[\r\n]+/g, ' ').slice(0, 240);
}

function buildXmpPacket(data: IptcXmpData): string {
  const keywordTags = data.keywords
    .map((k) => `          <rdf:li>${escapeXml(k)}</rdf:li>`)
    .join('\n');
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6-c140">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:xmp="http://ns.adobe.com/xap/1.0/"
      xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/"
      xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
      <dc:format>application/postscript</dc:format>
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
      <photoshop:Credit>${escapeXml(data.author)}</photoshop:Credit>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)) as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Escape a PostScript literal string for `(...)` syntax.
function escapePsString(str: string): string {
  return escapePsComment(str)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

// Accepts the raw EPS file contents as a string and returns EPS-10 compliant
// output with embedded DSC comments, a pdfmark DOCINFO block, and an XMP
// packet — without duplicating existing comments or disturbing binary data
// past %%EndComments / preview segments.
export function embedMetadataIntoEpsText(epsText: string, data: IptcXmpData): string {
  // 1) Guarantee an EPS-10 magic header (Adobe-3.0 EPSF-3.0 is the current EPS 10 baseline).
  const hasHeader = /^%!PS-Adobe-[0-9.]+\s+EPSF-[0-9.]+/i.test(epsText);
  if (!hasHeader) {
    epsText = '%!PS-Adobe-3.0 EPSF-3.0\n' + epsText;
  }

  // 2) Remove any existing DSC lines we are about to rewrite so we don't emit duplicates.
  const managedKeys = ['Title', 'Creator', 'CreationDate', 'Copyright', 'For', 'Keywords', 'Subject', 'LanguageLevel', 'Pages'];
  const managedRe = new RegExp(`^%%(?:${managedKeys.join('|')}):[^\\n]*\\n`, 'gm');
  let out = epsText.replace(managedRe, '');

  // 3) Build fresh DSC lines (EPS 10 requires LanguageLevel + Pages).
  const dscLines = [
    `%%Title: ${escapePsComment(data.title)}`,
    `%%Creator: ${escapePsComment(data.author)}`,
    `%%CreationDate: ${new Date().toUTCString()}`,
    `%%Copyright: ${escapePsComment(data.copyright || '')}`,
    `%%For: ${escapePsComment(data.author)}`,
    `%%Keywords: ${escapePsComment(data.keywords.join(', '))}`,
    `%%Subject: ${escapePsComment(data.description)}`,
    `%%LanguageLevel: 2`,
    `%%Pages: 0`,
  ].join('\n') + '\n';

  // 4) Insert DSC block directly after the %!PS header line so parsers see them
  //    as part of the header comments (before %%EndComments if present).
  out = out.replace(/^(%!PS-Adobe-[^\n]*\n)/, `$1${dscLines}`);

  // 5) Ensure a %%EndComments marker exists so the XMP block lands in the prolog,
  //    not inside header comments (required by EPS 10 parsers like Vecteezy's).
  if (!/^%%EndComments\s*$/m.test(out)) {
    // Insert %%EndComments after the last header-line %% comment following the header.
    out = out.replace(
      /^(%!PS-Adobe-[^\n]*\n(?:%%[^\n]*\n)*)/,
      `$1%%EndComments\n`
    );
  }

  // 6) Build XMP + pdfmark block as a comment-wrapped island so it never
  //    disturbs the vector operator stream that follows.
  const xmpPacket = buildXmpPacket(data);
  const xmpEpsBlock =
    '%%BeginProlog\n' +
    '/pdfmark where {pop} {userdict /pdfmark /cleartomark load put} ifelse\n' +
    '[ /Title (' + escapePsString(data.title) + ')\n' +
    '  /Author (' + escapePsString(data.author) + ')\n' +
    '  /Subject (' + escapePsString(data.description) + ')\n' +
    '  /Keywords (' + escapePsString(data.keywords.join(', ')) + ')\n' +
    '  /DOCINFO pdfmark\n' +
    '%%EndProlog\n' +
    '%begin_xml_packet\n' +
    xmpPacket
      .split('\n')
      .map((l) => '% ' + l)
      .join('\n') +
    '\n%end_xml_packet\n';

  // 7) Strip any pre-existing prolog block we previously injected (idempotent re-runs).
  out = out.replace(/%%BeginProlog[\s\S]*?%end_xml_packet\s*\n/, '');

  // 8) Insert the XMP/prolog block immediately after %%EndComments.
  out = out.replace(/(^%%EndComments\s*\n)/m, `$1${xmpEpsBlock}`);

  return out;
}
    xmpEpsBlock +
    epsText
  );
}

// Public entry point: takes the EPS data URL (any common variant) and returns
// a new data URL of MIME application/postscript with metadata embedded.
export function embedMetadataIntoEpsDataUrl(epsDataUrl: string, data: IptcXmpData): string {
  try {
    const commaIdx = epsDataUrl.indexOf(',');
    if (commaIdx === -1) return epsDataUrl;
    const header = epsDataUrl.slice(0, commaIdx);
    const payload = epsDataUrl.slice(commaIdx + 1);

    let epsText: string;
    if (/;base64/i.test(header)) {
      const bytes = base64ToBytes(payload);
      epsText = new TextDecoder('latin1').decode(bytes);
    } else {
      epsText = decodeURIComponent(payload);
    }

    const updated = embedMetadataIntoEpsText(epsText, data);
    const updatedBytes = new TextEncoder().encode(updated);
    return 'data:application/postscript;base64,' + bytesToBase64(updatedBytes);
  } catch (err) {
    console.error('Failed to embed EPS metadata', err);
    return epsDataUrl;
  }
}

// Read a File as a UTF-8 text data URL (application/postscript).
export function epsFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      if (!result) return reject(new Error('Empty EPS file'));
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Failed to read EPS file'));
    reader.readAsDataURL(file);
  });
}
