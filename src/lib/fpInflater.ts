// FP mode: ensure the output is JPG and at least `minBytes` in file size.
// Strategy: render to a JPEG canvas (flattening any transparency onto white)
// at quality 0.98, then progressively upscale until the encoded blob is large
// enough or we hit a safety dimension cap.

const MAX_DIMENSION = 6000;
const MIN_BYTES_DEFAULT = 2 * 1024 * 1024; // 2 MB

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for FP processing'));
    img.src = dataUrl;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function renderJpeg(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('Failed to get canvas context'));
      return;
    }
    // Flatten any transparency onto white so JPEG output is clean
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    try {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            try {
              const url = canvas.toDataURL('image/jpeg', quality);
              fetch(url).then((r) => r.blob()).then(resolve).catch(reject);
            } catch (err) {
              reject(new Error(`Canvas export failed: ${err}`));
            }
            return;
          }
          resolve(blob);
        },
        'image/jpeg',
        quality
      );
    } catch (err) {
      reject(new Error(`toBlob threw: ${err}`));
    }
  });
}

export async function ensureJpegMinSize(
  dataUrl: string,
  minBytes: number = MIN_BYTES_DEFAULT,
  maxDimension: number = MAX_DIMENSION
): Promise<string> {
  if (!dataUrl || dataUrl.length < 100) {
    throw new Error('Invalid data URL for FP processing');
  }

  const img = await loadImage(dataUrl);
  const baseW = img.naturalWidth || img.width;
  const baseH = img.naturalHeight || img.height;

  if (!baseW || !baseH) {
    throw new Error('Could not determine image dimensions for FP processing');
  }

  const quality = 0.98;
  let scale = 1;
  let width = baseW;
  let height = baseH;
  let blob = await renderJpeg(img, width, height, quality);

  // Progressively upscale until file size threshold is met or we hit the cap
  let safety = 0;
  while (blob.size < minBytes && safety < 12) {
    const nextScale = scale * 1.25;
    const nextW = Math.round(baseW * nextScale);
    const nextH = Math.round(baseH * nextScale);
    if (nextW > maxDimension || nextH > maxDimension) {
      // Snap to the maximum dimension and try once more, then stop
      const capScale = Math.min(maxDimension / baseW, maxDimension / baseH);
      if (capScale > scale) {
        scale = capScale;
        width = Math.floor(baseW * scale);
        height = Math.floor(baseH * scale);
        blob = await renderJpeg(img, width, height, quality);
      }
      break;
    }
    scale = nextScale;
    width = nextW;
    height = nextH;
    blob = await renderJpeg(img, width, height, quality);
    safety++;
  }

  return blobToDataUrl(blob);
}
