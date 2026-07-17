/**
 * EPS preview extractor.
 *
 * Browsers can't render PostScript. But most EPS files (especially those
 * exported from Illustrator / CorelDRAW for stock platforms) embed a small
 * raster preview intended for exactly this purpose:
 *
 *   1. "DOS EPS" binary wrapper — magic bytes C5 D0 D3 C6, followed by a
 *      28-byte header pointing at optional PostScript / WMF / TIFF sections.
 *      We prefer the TIFF preview.
 *   2. Plain ASCII EPS — may contain a %%BeginPreview / %%EndPreview EPSI
 *      block (hex-encoded 1-bit-per-pixel bitmap).
 *
 * We extract whichever preview is available, decode it, and hand back a
 * PNG data URL so the rest of the pipeline (thumbnail, AI vision call,
 * metadata generation) can treat the EPS just like any other raster upload.
 *
 * The ORIGINAL .eps file is left untouched — this only produces a visual
 * preview for downstream consumers. Metadata embedding and download still
 * use the original EPS bytes.
 */

// UTIF is loaded dynamically so it only ships when actually needed.
type UTIFModule = {
  decode: (buf: ArrayBuffer) => Array<{ width: number; height: number }>;
  decodeImage: (buf: ArrayBuffer, ifd: { width: number; height: number }) => void;
  toRGBA8: (ifd: { width: number; height: number }) => Uint8Array;
};

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

async function tiffBufferToPngDataUrl(tiffBuf: ArrayBuffer): Promise<string> {
  const UTIF = (await import('utif')) as unknown as UTIFModule & { default?: UTIFModule };
  const mod: UTIFModule = (UTIF.default ?? UTIF) as UTIFModule;
  const ifds = mod.decode(tiffBuf);
  if (!ifds.length) throw new Error('TIFF preview contained no image data');
  const ifd = ifds[0];
  mod.decodeImage(tiffBuf, ifd);
  const rgba = mod.toRGBA8(ifd);

  const canvas = document.createElement('canvas');
  canvas.width = ifd.width;
  canvas.height = ifd.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  const imgData = ctx.createImageData(ifd.width, ifd.height);
  imgData.data.set(rgba);
  ctx.putImageData(imgData, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Try to decode an ASCII EPSI %%BeginPreview / %%EndPreview block. This is
 * a hex-encoded, typically 1-bit-per-pixel bitmap. We render it as a
 * grayscale PNG so at least SOMETHING viewable comes through even for EPS
 * files without a binary TIFF preview.
 */
function decodeEpsiPreview(asciiHead: string): string | null {
  const beginMatch = asciiHead.match(/%%BeginPreview:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/);
  if (!beginMatch) return null;
  const width = parseInt(beginMatch[1], 10);
  const height = parseInt(beginMatch[2], 10);
  const depth = parseInt(beginMatch[3], 10);
  if (!width || !height || depth !== 1) return null;

  const beginIdx = asciiHead.indexOf(beginMatch[0]);
  const endIdx = asciiHead.indexOf('%%EndPreview', beginIdx);
  if (endIdx < 0) return null;
  const body = asciiHead.slice(beginIdx + beginMatch[0].length, endIdx);
  const hex = body.replace(/^%|[^0-9a-fA-F]/gm, '');
  if (hex.length < 2) return null;

  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  const rowBytes = Math.ceil(width / 8);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const byte = bytes[y * rowBytes + (x >> 3)] ?? 0xff;
      const bit = (byte >> (7 - (x & 7))) & 1;
      const v = bit ? 0 : 255; // 1 = ink in EPSI
      const p = (y * width + x) * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/**
 * Extract a preview from an EPS file. Returns a PNG data URL, or null if
 * the file has no embedded preview we can decode.
 */
export async function extractEpsPreview(file: File): Promise<string | null> {
  const buf = await file.arrayBuffer();
  if (buf.byteLength < 32) return null;
  const view = new DataView(buf);

  // Binary DOS EPS: magic C5 D0 D3 C6
  if (
    view.getUint8(0) === 0xc5 &&
    view.getUint8(1) === 0xd0 &&
    view.getUint8(2) === 0xd3 &&
    view.getUint8(3) === 0xc6
  ) {
    const tiffOffset = readUint32LE(view, 20);
    const tiffLength = readUint32LE(view, 24);
    const wmfOffset = readUint32LE(view, 12);
    const wmfLength = readUint32LE(view, 16);

    if (tiffLength > 0 && tiffOffset + tiffLength <= buf.byteLength) {
      try {
        const slice = buf.slice(tiffOffset, tiffOffset + tiffLength);
        return await tiffBufferToPngDataUrl(slice);
      } catch (err) {
        console.warn('[EPS] TIFF preview decode failed', err);
      }
    }
    if (wmfLength > 0 && wmfOffset + wmfLength <= buf.byteLength) {
      // WMF isn't decodable in-browser without a heavy dep. Skip.
      console.warn('[EPS] Only WMF preview present — cannot decode in browser');
    }
    // Fall through to ASCII scan of the PostScript section.
    const psOffset = readUint32LE(view, 4);
    const psLength = readUint32LE(view, 8);
    if (psLength > 0 && psOffset + psLength <= buf.byteLength) {
      const ascii = new TextDecoder('latin1').decode(
        new Uint8Array(buf, psOffset, Math.min(psLength, 200_000))
      );
      const epsi = decodeEpsiPreview(ascii);
      if (epsi) return epsi;
    }
    return null;
  }

  // Plain ASCII / Mac EPS — scan the first ~200KB for %%BeginPreview.
  const ascii = new TextDecoder('latin1').decode(
    new Uint8Array(buf, 0, Math.min(buf.byteLength, 200_000))
  );
  const epsi = decodeEpsiPreview(ascii);
  return epsi;
}
