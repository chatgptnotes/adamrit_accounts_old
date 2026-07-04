/** Client-side image downscale/compress helpers for tablet uploads. */

/** Load a File/Blob into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Re-encode an image File so it fits under `maxBytes`, by capping the longest
 * side and stepping JPEG quality down until it's small enough. Non-image files
 * are returned unchanged. Best-effort: returns the smallest version it can
 * produce even if it can't get fully under the limit.
 */
export async function compressImageToLimit(
  file: File,
  maxBytes: number,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  if (file.size <= maxBytes) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let maxSide = 1600; // start cap on the longest edge
    let best: Blob | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, w, h);

      for (const quality of [0.8, 0.6, 0.45, 0.3]) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (blob && (!best || blob.size < best.size)) best = blob;
        if (blob && blob.size <= maxBytes) {
          return blobToJpegFile(blob, file.name);
        }
      }
      maxSide = Math.round(maxSide * 0.75); // shrink further and retry
    }

    // Couldn't hit the target — return the smallest we managed.
    return best ? blobToJpegFile(best, file.name) : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function blobToJpegFile(blob: Blob, originalName: string): File {
  const base = originalName.replace(/\.[^.]+$/, "");
  return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
}
