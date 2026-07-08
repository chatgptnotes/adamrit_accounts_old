import { captureGeolocation, type CaptureSource, type GeoCapture } from '@/lib/geotag';
import { embedGpsInJpeg } from '@/lib/embedGeotagExif';
import { stampGeotagOnImage } from '@/lib/geotagImage';

export interface InAppCaptureResult {
  blob: Blob;
  geo: GeoCapture | null;
  captureSource: CaptureSource;
}

function drawVideoToJpegBlob(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  quality = 0.9,
): Promise<Blob | null> {
  if (!video.videoWidth || !video.videoHeight) {
    return Promise.resolve(null);
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Capture a frame from a live video stream and attempt GPS in parallel.
 * Embeds GPS into JPEG EXIF when available.
 */
export async function captureInAppPhoto(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  quality = 0.9,
  options: { placeLabel?: string } = {},
): Promise<InAppCaptureResult | null> {
  const [rawBlob, geo] = await Promise.all([
    drawVideoToJpegBlob(video, canvas, quality),
    captureGeolocation(),
  ]);

  if (!rawBlob) return null;

  const exifBlob = await embedGpsInJpeg(rawBlob, geo);
  const stamped = await stampGeotagOnImage(exifBlob, geo, {
    fileName: `capture_${Date.now()}.jpg`,
    fileType: 'image/jpeg',
    placeLabel: options.placeLabel,
  });
  return {
    blob: stamped.blob,
    geo,
    captureSource: 'in_app_camera',
  };
}

/** Re-embed GPS into an existing JPEG blob (e.g. after retry). */
export async function reapplyGeotagToBlob(
  blob: Blob,
  geo: GeoCapture | null,
  options: { placeLabel?: string } = {},
): Promise<Blob> {
  const exifBlob = await embedGpsInJpeg(blob, geo);
  const stamped = await stampGeotagOnImage(exifBlob, geo, {
    fileName: `capture_${Date.now()}.jpg`,
    fileType: 'image/jpeg',
    placeLabel: options.placeLabel,
  });
  return stamped.blob;
}
