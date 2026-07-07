import piexif from 'piexifjs';
import type { GeoCapture } from '@/lib/geotag';

function toDmsRational(coord: number): [[number, number], [number, number], [number, number]] {
  const abs = Math.abs(coord);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 100);

  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 100],
  ];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** Embed GPS coordinates into a JPEG blob. Returns original blob if geo is null or not JPEG. */
export async function embedGpsInJpeg(blob: Blob, geo: GeoCapture | null): Promise<Blob> {
  if (!geo) return blob;
  if (!blob.type.startsWith('image/jpeg') && !blob.type.startsWith('image/jpg')) {
    return blob;
  }

  try {
    const dataUrl = await blobToDataUrl(blob);
    const exifObj = piexif.load(dataUrl);

    exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = geo.latitude >= 0 ? 'N' : 'S';
    exifObj.GPS[piexif.GPSIFD.GPSLatitude] = toDmsRational(geo.latitude);
    exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = geo.longitude >= 0 ? 'E' : 'W';
    exifObj.GPS[piexif.GPSIFD.GPSLongitude] = toDmsRational(geo.longitude);

    const exifBytes = piexif.dump(exifObj);
    const tagged = piexif.insert(exifBytes, dataUrl);
    return dataUrlToBlob(tagged);
  } catch {
    return blob;
  }
}

/** Geotag a file from native camera capture (JPEG only). */
export async function geotagJpegFile(file: File, geo: GeoCapture | null): Promise<File> {
  if (!geo || !file.type.startsWith('image/')) return file;
  const blob = await embedGpsInJpeg(file, geo);
  if (blob === file) return file;
  return new File([blob], file.name, { type: 'image/jpeg', lastModified: file.lastModified });
}
