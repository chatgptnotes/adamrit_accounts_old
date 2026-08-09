import Tesseract from 'tesseract.js';
import jsQR from 'jsqr';

export interface ExtractedPatientData {
  name?: string;
  age?: string;
  dob?: string;
  gender?: string;
  phone?: string;
  address?: string;
  aadhaar?: string;
}

// Preprocess: resize + grayscale + contrast stretch (+ optional QR-area masking)
async function preprocessImage(file: File, maskQr = false): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1800;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      // QR detection on ORIGINAL colour data — must run before grayscale
      if (maskQr) {
        try {
          const qr = jsQR(d, w, h);
          if (qr?.location) {
            const xs = [qr.location.topLeftCorner.x, qr.location.topRightCorner.x,
                        qr.location.bottomLeftCorner.x, qr.location.bottomRightCorner.x];
            const ys = [qr.location.topLeftCorner.y, qr.location.topRightCorner.y,
                        qr.location.bottomLeftCorner.y, qr.location.bottomRightCorner.y];
            const pad = 15;
            const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad);
            const y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
            const x1 = Math.min(w, Math.ceil(Math.max(...xs)) + pad);
            const y1 = Math.min(h, Math.ceil(Math.max(...ys)) + pad);
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const i = (y * w + x) * 4;
                d[i] = d[i + 1] = d[i + 2] = 255;
              }
            }
            console.log('[QR masked]', { x0, y0, x1, y1 });
          } else {
            console.log('[QR not detected]');
          }
        } catch (e) {
          console.warn('[QR detect failed]', e);
        }
      }

      // Grayscale + find luminance min/max for contrast stretch
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) {
        const gray = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
        d[i] = d[i + 1] = d[i + 2] = gray;
        if (gray < min) min = gray;
        if (gray > max) max = gray;
      }
      const lo = Math.min(min + 5, 50);
      const hi = Math.max(max - 5, 200);
      const range = hi - lo || 1;
      for (let i = 0; i < d.length; i += 4) {
        let v = ((d[i] - lo) * 255 / range) | 0;
        if (v < 0) v = 0; else if (v > 255) v = 255;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(imageData, 0, 0);

      canvas.toBlob(
        (blob) => { if (blob) resolve(blob); else reject(new Error('canvas toBlob failed')); },
        'image/jpeg',
        0.95
      );
    };
    img.onerror = reject;
    img.src = url;
  });
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function extractTextFromImage(
  file: File,
  onProgress?: (pct: number) => void,
  maskQr = false,
): Promise<OcrResult> {
  const processed = await preprocessImage(file, maskQr);
  const result = await Tesseract.recognize(processed, 'hin+eng', {
    logger: (m) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });
  console.log('[OCR RAW TEXT]\n', result.data.text);
  console.log('[OCR CONFIDENCE]', result.data.confidence);
  return { text: result.data.text, confidence: result.data.confidence };
}

export function parsePatientData(text: string): ExtractedPatientData {
  const data: ExtractedPatientData = {};
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  // Aadhaar — printed as three groups of four. Read before the phone so the
  // groups are claimed here rather than half-matched as a mobile number.
  // A 16-digit run is a VID, not an Aadhaar, so the boundaries stay strict.
  const aadhaarMatch = text.match(/(?:^|\D)(\d{4}\s\d{4}\s\d{4})(?:\D|$)/);
  if (aadhaarMatch) data.aadhaar = aadhaarMatch[1].replace(/\s/g, '');

  // Phone — 10-digit Indian mobile
  const phoneMatch = text.match(/(?:^|\D)((?:6|7|8|9)\d{9})(?:\D|$)/m);
  if (phoneMatch) data.phone = phoneMatch[1];

  // DOB — DD/MM/YYYY or DD-MM-YYYY
  const dobMatch = text.match(/\b(\d{2})[\/\-](\d{2})[\/\-](\d{4})\b/);
  if (dobMatch) {
    data.dob = `${dobMatch[3]}-${dobMatch[2]}-${dobMatch[1]}`; // YYYY-MM-DD
    // Derive age from DOB
    const birthYear = parseInt(dobMatch[3]);
    const currentYear = new Date().getFullYear();
    if (birthYear > 1900 && birthYear <= currentYear) {
      data.age = String(currentYear - birthYear);
    }
  }

  // Age — standalone "Age: 34" or "34 Years"
  if (!data.age) {
    const ageMatch = text.match(/\bage[:\s]+(\d{1,3})\b/i) || text.match(/\b(\d{1,3})\s*(?:yrs?|years?)\b/i);
    if (ageMatch) data.age = ageMatch[1];
  }

  // Gender
  if (/\b(male|MALE|M)\b/.test(text) && !/female/i.test(text)) data.gender = 'Male';
  else if (/\b(female|FEMALE|F)\b/.test(text)) data.gender = 'Female';

  const BLACKLIST = [
    'government', 'india', 'unique', 'identification', 'authority', 'uidai',
    'aadhaar', 'aadhar', 'republic', 'income', 'tax', 'pan', 'card',
    'driving', 'licence', 'license', 'passport', 'voter', 'election',
    'commission', 'state', 'district', 'address', 'date', 'birth',
    'male', 'female', 'dob', 'year', 'valid', 'issue', 'expiry',
    'download', 'enrolment', 'enrollment', 'digitally', 'signed',
    // Address words
    'sector', 'nagar', 'flat', 'floor', 'road', 'street', 'block',
    'colony', 'village', 'near', 'post', 'house', 'tehsil', 'taluk',
    'faridabad', 'delhi', 'haryana', 'mumbai', 'plot', 'ward',
  ];

  const isBlacklisted = (line: string) =>
    BLACKLIST.some((w) => line.toLowerCase().includes(w));

  const hasVowel = (w: string) => /[aeiouAEIOU]/.test(w);

  const isValidName = (line: string) => {
    if (!line || line.length < 6 || line.length > 60) return false;
    if (/\d/.test(line)) return false;
    if (isBlacklisted(line)) return false;
    const words = line.trim().split(/\s+/);
    if (words.length < 1 || words.length > 5) return false;
    // Every word must be 3+ chars (rejects "Re", "fke" type garbled OCR)
    if (!words.every((w) => w.length >= 3)) return false;
    // First letter must be uppercase
    if (!/^[A-Z]/.test(words[0])) return false;
    // Every word must have at least one vowel
    if (!words.every(hasVowel)) return false;
    return true;
  };

  console.log('[OCR LINES]', lines);

  // Strategy 1: explicit "Name:" label
  const nameLabelMatch = text.match(/(?:^|\n)\s*(?:name|patient\s*name)\s*[:\-]\s*([A-Za-z][A-Za-z\s\.]{4,40})/im);
  if (nameLabelMatch) {
    const candidate = cleanName(nameLabelMatch[1]);
    console.log('[S1 candidate]', candidate, 'valid?', isValidName(candidate));
    if (isValidName(candidate)) data.name = candidate;
  }

  // Strategy 2 (Aadhaar back): name sits just BEFORE the DOB line
  if (!data.name) {
    const dobIdx = lines.findIndex((l) =>
      /\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/.test(l) ||
      /dob|date\s*of\s*birth|जन्म/i.test(l)
    );
    console.log('[S2 dobIdx]', dobIdx, 'line:', lines[dobIdx]);
    if (dobIdx > 0) {
      for (let i = dobIdx - 1; i >= Math.max(0, dobIdx - 8); i--) {
        const candidate = cleanName(lines[i]);
        console.log('[S2 trying]', lines[i], '→', candidate, 'valid?', isValidName(candidate));
        if (isValidName(candidate)) {
          data.name = candidate;
          break;
        }
      }
    }
  }

  // Strategy 3 (Aadhaar front): name sits just BEFORE "S/O", "D/O", "W/O", "C/O"
  // Also matches "Son of", "Daughter of", "Wife of", "Husband of"
  if (!data.name) {
    const relIdx = lines.findIndex((l) =>
      /^[SDWHCO]\s*[\/|\\]\s*O\b/i.test(l) ||
      /^(?:son|daughter|wife|husband|care)\s+of\b/i.test(l)
    );
    console.log('[S3 relIdx]', relIdx, 'matched line:', lines[relIdx]);
    if (relIdx > 0) {
      for (let i = relIdx - 1; i >= Math.max(0, relIdx - 4); i--) {
        const candidate = cleanName(lines[i]);
        console.log('[S3 trying]', lines[i], '→', candidate, 'valid?', isValidName(candidate));
        if (isValidName(candidate)) {
          data.name = candidate;
          break;
        }
      }
    }
  }

  // Strategy 4: ALL-CAPS line (1+ words) — common on Aadhaar
  if (!data.name) {
    for (const line of lines.slice(2)) {
      const candidate = cleanName(line);
      if (/^[A-Z]{2,}(?: [A-Z]{2,})*$/.test(line) && isValidName(candidate)) {
        console.log('[S4 match]', line);
        data.name = candidate;
        break;
      }
    }
  }

  // Strategy 5: first title-case line after skipping header lines (UIDAI, Govt etc.)
  if (!data.name) {
    const headerEnd = lines.findIndex((l) => !isBlacklisted(l) && !/uidai|govt|government|unique/i.test(l));
    const start = headerEnd >= 0 ? headerEnd : 2;
    for (const line of lines.slice(start)) {
      const candidate = cleanName(line);
      if (isValidName(candidate) && /^[A-Z][a-z]/.test(candidate)) {
        console.log('[S5 match]', line);
        data.name = candidate;
        break;
      }
    }
  }

  console.log('[OCR RESULT]', data);

  // Address — capture after "Address:" / "S/O" / "D/O" etc. and stop at UIDAI noise
  const addrMatch =
    text.match(/address[:\s]+([\s\S]+?)(?:\n\n|uidai|www\.|help|1947|mera\s*aadhaar|original\s*aadhaar|$)/i) ||
    text.match(/((?:[SDWHCO]\s*[\/|\\]\s*O\b|son\s+of|daughter\s+of|wife\s+of|husband\s+of|care\s+of)[\s\S]+?)(?:uidai|www\.|help|1947|mera\s*aadhaar|original\s*aadhaar|$)/i);

  if (addrMatch) {
    let addr = addrMatch[1]
      .replace(/[^\x00-\x7F]/g, ' ')          // strip Devanagari
      .replace(/\b\d{4}\s\d{4}\s\d{4}\b/g, '') // strip Aadhaar number
      .replace(/\n/g, ', ')
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*,+/g, ', ')
      .trim();

    // Hard stop at PIN code (6 digits) — valid Indian address always ends here
    const pinMatch = addr.match(/^(.+?\b\d{6}\b)/);
    if (pinMatch) addr = pinMatch[1].trim();

    // Final cleanup: remove trailing commas/punct
    addr = addr.replace(/[,\s\-]+$/, '');
    if (addr.length > 10) data.address = addr;
  }

  return data;
}

function cleanName(raw: string): string {
  // Strip non-ASCII first (Hindi/Devanagari) — don't count these in ratio check
  const asciiPart = raw.replace(/[^\x00-\x7F]/g, ' ');
  const cleaned = asciiPart
    .replace(/[^A-Za-z\s\.]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
  // Reject only if the ASCII portion itself got mostly stripped (garbled Latin)
  const asciiLen = asciiPart.trim().length;
  if (asciiLen > 4 && cleaned.length < asciiLen * 0.5) return '';
  return cleaned;
}
