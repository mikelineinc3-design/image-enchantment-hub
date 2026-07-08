// Rasterize SVG artwork to a PNG data URL for vision AI analysis.
// Keeps the original SVG file untouched — the PNG is used ONLY as a visual
// hint sent to the metadata AI so titles/keywords describe what's actually
// drawn instead of guessing from the filename.

export async function rasterizeSvgTextToPng(svgText: string, maxDim = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth || 1024;
        const h = img.naturalHeight || 1024;
        const scale = Math.min(1, maxDim / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D unavailable');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG rasterization failed'));
    };
    img.src = url;
  });
}

export async function rasterizeSvgDataUrlToPng(svgDataUrl: string, maxDim = 1024): Promise<string> {
  const commaIdx = svgDataUrl.indexOf(',');
  if (commaIdx === -1) throw new Error('Invalid SVG data URL');
  const header = svgDataUrl.slice(0, commaIdx);
  const payload = svgDataUrl.slice(commaIdx + 1);
  let text: string;
  if (/;base64/i.test(header)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    text = new TextDecoder('utf-8').decode(bytes);
  } else {
    text = decodeURIComponent(payload);
  }
  return rasterizeSvgTextToPng(text, maxDim);
}
