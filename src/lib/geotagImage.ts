import { type GeoCapture } from '@/lib/geotag';

export interface GeotaggedImageResult {
  blob: Blob;
  fileName: string;
  fileType: string;
}

const IMAGE_TYPES_WITH_CANVAS_SUPPORT = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function formatLocalTimestamp(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'shortOffset',
  }).format(new Date(iso));
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function drawMapPreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  geo: GeoCapture,
  scale: number,
) {
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, '#16324f');
  gradient.addColorStop(0.55, '#1f4a73');
  gradient.addColorStop(1, '#355f8a');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, width, height);

  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, Math.round(scale));
  const gridStep = Math.max(18, Math.round(24 * scale));
  for (let gx = x; gx <= x + width; gx += gridStep) {
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx, y + height);
    ctx.stroke();
  }
  for (let gy = y; gy <= y + height; gy += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x + width, gy);
    ctx.stroke();
  }
  ctx.restore();

  const pinX = x + width * (0.35 + ((geo.longitude % 1) + 1) % 1 * 0.3);
  const pinY = y + height * (0.35 + ((geo.latitude % 1) + 1) % 1 * 0.25);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.ellipse(pinX + 3, pinY + height * 0.18, 18 * scale, 8 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(pinX, pinY - 18 * scale);
  ctx.bezierCurveTo(pinX - 14 * scale, pinY - 2 * scale, pinX - 10 * scale, pinY + 18 * scale, pinX, pinY + 28 * scale);
  ctx.bezierCurveTo(pinX + 10 * scale, pinY + 18 * scale, pinX + 14 * scale, pinY - 2 * scale, pinX, pinY - 18 * scale);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(pinX, pinY - 2 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function imageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new window.Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image for geotag stamp'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create geotagged image'));
    }, type, quality);
  });
}

export async function stampGeotagOnImage(
  blob: Blob,
  geo: GeoCapture | null,
  options: { fileName?: string; fileType?: string; placeLabel?: string } = {},
): Promise<GeotaggedImageResult> {
  const requestedType = options.fileType || blob.type || 'image/jpeg';
  if (!geo || !IMAGE_TYPES_WITH_CANVAS_SUPPORT.has(requestedType)) {
    return {
      blob,
      fileName: options.fileName || 'photo.jpg',
      fileType: requestedType,
    };
  }

  const img = await imageFromBlob(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      blob,
      fileName: options.fileName || 'photo.jpg',
      fileType: requestedType,
    };
  }

  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const scale = Math.max(1, canvas.width / 1200);
  const pad = Math.round(20 * scale);
  const cardRadius = Math.round(16 * scale);
  const mapW = Math.round(Math.min(canvas.width * 0.20, 170 * scale));
  const mapH = Math.round(Math.min(canvas.height * 0.18, 160 * scale));
  const titleSize = Math.round(24 * scale);
  const subTitleSize = Math.round(17 * scale);
  const bodySize = Math.round(15 * scale);
  const tinySize = Math.round(14 * scale);
  const lineHeight = Math.round(19 * scale);
  const place = options.placeLabel || 'GPS location captured';
  const textMaxWidth = Math.max(260 * scale, canvas.width - mapW - pad * 4);
  const placeRows = wrapText(ctx, place, textMaxWidth);
  const infoRows = [
    `Lat ${geo.latitude.toFixed(6)}   Long ${geo.longitude.toFixed(6)}`,
    formatLocalTimestamp(geo.capturedAt),
  ].filter(Boolean);

  const overlayHeight = Math.round(230 * scale);
  const y = canvas.height - overlayHeight;

  ctx.fillStyle = 'rgba(10, 16, 28, 0.72)';
  ctx.fillRect(0, y, canvas.width, overlayHeight);

  const mapX = pad;
  const mapY = y + pad;
  drawMapPreview(ctx, mapX, mapY, mapW, mapH, geo, scale);

  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = Math.max(1, Math.round(1 * scale));
  ctx.beginPath();
  ctx.roundRect(mapX, mapY, mapW, mapH, cardRadius);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const textX = mapX + mapW + pad;
  const subtitleCount = placeRows.length;
  const infoCount = infoRows.length;
  const totalTextHeight =
    titleSize +
    subtitleCount * lineHeight +
    Math.round(2 * scale) +
    infoCount * lineHeight;
  let textY = mapY + Math.max(0, Math.round((mapH - totalTextHeight) / 2));

  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = Math.round(5 * scale);
  ctx.shadowOffsetX = Math.round(1 * scale);
  ctx.shadowOffsetY = Math.round(1 * scale);

  ctx.font = `700 ${titleSize}px Arial, sans-serif`;
  ctx.fillText('GPS Map Camera', textX, textY);
  textY += titleSize + Math.round(2 * scale);

  ctx.font = `700 ${subTitleSize}px Arial, sans-serif`;
  placeRows.forEach((row) => {
    ctx.fillText(row, textX, textY);
    textY += lineHeight;
  });

  textY += Math.round(2 * scale);
  ctx.font = `500 ${bodySize}px Arial, sans-serif`;
  infoRows.forEach((row) => {
    ctx.fillText(row, textX, textY);
    textY += lineHeight;
  });
  const outputType = requestedType === 'image/png' ? 'image/png' : 'image/jpeg';
  const stampedBlob = await canvasToBlob(canvas, outputType);
  const originalName = options.fileName || 'photo.jpg';
  const fileName = outputType === 'image/jpeg'
    ? originalName.replace(/\.(png|webp|gif)$/i, '.jpg')
    : originalName;

  return {
    blob: stampedBlob,
    fileName,
    fileType: outputType,
  };
}
