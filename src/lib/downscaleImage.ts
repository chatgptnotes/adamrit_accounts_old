// Downscale + re-encode an image before sending it to a vision model.
//
// Phone/camera photos are 2-4 MB at 3000-4000px. Gemini Vision bills input
// tokens by image size, so sending the raw photo costs ~3-5x more tokens than
// a right-sized one with no OCR-quality gain. We cap the long edge at
// MAX_EDGE px and re-encode as JPEG, which is plenty for reading text.
//
// Falls back to the original blob if anything goes wrong (decode failure,
// no canvas, SVG, etc.) so a scan never breaks just because resizing failed.

const MAX_EDGE = 1600; // long-edge cap in px — keeps handwriting legible
const JPEG_QUALITY = 0.8;

export interface DownscaledImage {
  blob: Blob;
  base64: string; // raw base64 (no data: prefix), ready for inline_data.data
  mimeType: string;
}

// Per-call overrides for flows that need more detail than the defaults — e.g.
// reading handwriting off a photographed form, where 1600px loses the pen strokes.
export interface DownscaleOptions {
  maxEdge?: number;
  quality?: number;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(blob);
  });
}

function stripBase64(dataUrl: string): string {
  return dataUrl.split(',')[1] ?? '';
}

/**
 * Downscale `input` so its longest edge is at most MAX_EDGE px and return the
 * JPEG bytes + ready-to-send base64. If the image is already small enough, or
 * resizing is not possible, the original bytes are returned unchanged.
 *
 * Pass `opts` to raise the cap for a single call without changing it app-wide.
 */
export async function downscaleImageForVision(
  input: Blob,
  opts: DownscaleOptions = {},
): Promise<DownscaledImage> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const quality = opts.quality ?? JPEG_QUALITY;
  const originalMime = input.type || 'image/jpeg';

  // Non-raster or already-tiny inputs: send as-is.
  if (!originalMime.startsWith('image/') || originalMime === 'image/svg+xml') {
    const dataUrl = await readAsDataUrl(input);
    return { blob: input, base64: stripBase64(dataUrl), mimeType: originalMime };
  }

  try {
    const bitmap = await createImageBitmap(input);
    const { width, height } = bitmap;
    const longEdge = Math.max(width, height);

    // Already within budget — no re-encode, keep original quality.
    if (longEdge <= maxEdge) {
      bitmap.close?.();
      const dataUrl = await readAsDataUrl(input);
      return { blob: input, base64: stripBase64(dataUrl), mimeType: originalMime };
    }

    const scale = maxEdge / longEdge;
    const targetW = Math.round(width * scale);
    const targetH = Math.round(height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas context');
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    bitmap.close?.();

    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    return { blob: dataURLtoBlob(dataUrl), base64: stripBase64(dataUrl), mimeType: 'image/jpeg' };
  } catch {
    // Decode/canvas failure — fall back to the untouched original.
    const dataUrl = await readAsDataUrl(input);
    return { blob: input, base64: stripBase64(dataUrl), mimeType: originalMime };
  }
}

function dataURLtoBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
