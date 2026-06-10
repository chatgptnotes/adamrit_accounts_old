// Read a utility bill (photo or PDF) WITHOUT any API key.
//
//  - PDF  → pull the embedded text layer with pdf.js (exact, no OCR needed).
//           Falls back to rendering page 1 → canvas → Tesseract for scanned PDFs.
//  - image → Tesseract.js OCR via the shared documentOcr helper.
//
// The raw text is then parsed with label-based regexes. Everything runs in the
// browser; the saved deadline row stays editable so any misread is correctable.
import Tesseract from 'tesseract.js';
import type { UtilityBillType } from '@/hooks/useUtilityDeadlines';

export interface ExtractedBill {
  name: string; // short label, e.g. "Electricity — MSEDCL"
  bill_type: UtilityBillType;
  amount: number; // payable on/by the due date
  due_date: string; // YYYY-MM-DD
  consumer_number: string; // account / consumer / connection number
  biller: string; // issuing company, e.g. "MSEDCL"
}

const isPdf = (file: Blob, name = ''): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(name);

// ── Text acquisition ────────────────────────────────────────────────

// Pull the embedded text layer from a digital PDF, preserving rough reading
// order (top→bottom, left→right). Returns '' for scanned PDFs (no text layer).
async function pdfTextLayer(file: Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).href;
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let all = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items as Array<{ str: string; transform: number[] }>;
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5]; // PDF Y is inverted
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.transform[4] - b.transform[4];
    });
    all += items.map((it) => it.str).join(' ') + '\n';
  }
  return all.trim();
}

// Bill-tuned preprocessing: upscale small photos so the dense small print is
// legible to Tesseract (it classifies best around ~30px cap-height), then
// grayscale + contrast-stretch to sharpen ink against paper. Returns a new
// canvas. Kept gentle (no hard binarization) so text inside the bill's coloured
// boxes — the amount/due-date header — isn't wiped out.
const OCR_TARGET_EDGE = 2400; // upscale toward this long edge; capped at 3x

function preprocessForOcr(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const longEdge = Math.max(w, h);
  const scale = longEdge < OCR_TARGET_EDGE ? Math.min(OCR_TARGET_EDGE / longEdge, 3) : 1;
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context for OCR preprocessing');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);

  const img = ctx.getImageData(0, 0, tw, th);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    d[i] = d[i + 1] = d[i + 2] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const lo = Math.min(min + 5, 60);
  const hi = Math.max(max - 5, 190);
  const range = hi - lo || 1;
  for (let i = 0; i < d.length; i += 4) {
    let v = ((d[i] - lo) * 255) / range;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Run Tesseract over a preprocessed canvas. English-only (bill labels, amounts
// and dates are Latin/numeric — dropping Devanagari cuts misreads), with
// inter-word spacing preserved so column groups like the amount trio survive.
async function ocrCanvas(canvas: HTMLCanvasElement): Promise<string> {
  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(canvas);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

// Render PDF page 1 to a canvas and OCR it — used only when there's no text layer.
async function pdfPageOcr(file: Blob): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.js',
    import.meta.url,
  ).href;
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.5 });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context for PDF render');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return ocrCanvas(preprocessForOcr(canvas, canvas.width, canvas.height));
}

// OCR a photo/image of a bill (camera capture or uploaded image).
async function ocrImage(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    return await ocrCanvas(preprocessForOcr(bitmap, bitmap.width, bitmap.height));
  } finally {
    bitmap.close?.();
  }
}

// Document-agnostic OCR: PDF text layer (or page-1 OCR for scanned PDFs) /
// image OCR → raw text. Exported so the generic task-document scanner can reuse
// it; the bill-specific parsing lives in parseUtilityBill below.
export async function readBillText(file: Blob, fileName: string): Promise<string> {
  if (isPdf(file, fileName)) {
    const text = await pdfTextLayer(file);
    if (text.replace(/\s/g, '').length >= 40) return text; // has a real text layer
    return await pdfPageOcr(file); // scanned PDF — OCR page 1
  }
  return await ocrImage(file); // camera capture or uploaded photo
}

// ── Parsing ─────────────────────────────────────────────────────────

// A rupee figure that may carry thousands separators and paise, e.g.
// "2,60,440", "1,730.00", "260440". Drops the paise and separators.
const AMT = '\\d[\\d,]*(?:\\.\\d{2})?';
const money = (s: string): number => {
  const n = parseFloat(String(s).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// Month abbreviations → 2-digit number, for "15 Jun 2026"-style dates.
const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Due-date label synonyms seen across MSEDCL, BSNL, Airtel and ISP bills.
const DUE_LABEL =
  '(?:due\\s*date|pay(?:ment)?\\s*(?:due\\s*)?(?:date|by)|last\\s*date(?:\\s*(?:of|for)\\s*payment)?|due\\s*on|bill\\s*due\\s*date)';

function parseDueDate(text: string): string {
  // 1. Numeric date next to a due-date label, e.g. "Due Date 15/06/2026".
  const labelled = text.match(new RegExp(`${DUE_LABEL}[^0-9]{0,20}(\\d{2})[/\\-.](\\d{2})[/\\-.](\\d{4})`, 'i'));
  if (labelled) return `${labelled[3]}-${labelled[2]}-${labelled[1]}`;
  // 2. Month-name date next to the label, e.g. "Pay by 15 Jun 2026".
  const labelledMon = text.match(
    new RegExp(`${DUE_LABEL}[^0-9A-Za-z]{0,20}(\\d{1,2})[\\s\\-]*([A-Za-z]{3,9})[\\s\\-]*(\\d{4})`, 'i'),
  );
  if (labelledMon) {
    const mm = MONTHS[labelledMon[2].toLowerCase().slice(0, 3)];
    if (mm) return `${labelledMon[3]}-${mm}-${labelledMon[1].padStart(2, '0')}`;
  }
  // 3. Fallback: latest date in the document (due date is usually later than the
  // bill date and any "if paid upto" date). Collect both numeric and month-name.
  const iso: string[] = [];
  for (const m of text.matchAll(/\b(\d{2})[/\-.](\d{2})[/\-.](\d{4})\b/g)) iso.push(`${m[3]}-${m[2]}-${m[1]}`);
  for (const m of text.matchAll(/\b(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s\-]+(\d{4})\b/g)) {
    const mm = MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mm) iso.push(`${m[3]}-${mm}-${String(m[1]).padStart(2, '0')}`);
  }
  if (iso.length === 0) return '';
  iso.sort();
  return iso[iso.length - 1];
}

function parseAmount(text: string, exclude: string[] = []): number {
  const t = text.replace(/\s+/g, ' ');
  // MSEDCL: header trio "Before PPD | After PPD upto Due Date | After Due Date"
  // followed by a value trio — the middle value is the payable-by-due-date one.
  const trio = t.match(new RegExp(`before\\s*ppd[\\s\\S]{0,160}?(${AMT})\\s+(${AMT})\\s+(${AMT})`, 'i'));
  if (trio) return money(trio[2]);
  // Single-column layout: value right after the "After PPD upto Due Date" label.
  const afterPpd = t.match(new RegExp(`after\\s*ppd\\s*up\\s*to\\s*due\\s*date[^0-9]{0,40}(${AMT})`, 'i'));
  if (afterPpd) return money(afterPpd[1]);
  // Generic billers: "Amount Payable" / "Total Amount Due" / "Net Amount" etc.
  const payable = t.match(
    new RegExp(
      `(?:amount\\s*payable|total\\s*amount\\s*(?:due|payable)|amount\\s*due|net\\s*(?:amount\\s*)?(?:amount|payable)?|grand\\s*total|bill\\s*amount|payable\\s*amount|total\\s*bill\\s*amount|total\\s*payable|sum\\s*payable|current\\s*(?:bill\\s*)?(?:amount|charges|outstanding)|outstanding\\s*amount)[^0-9]{0,40}(${AMT})`,
      'i',
    ),
  );
  if (payable) return money(payable[1]);
  // Last resort: pick the best rupee-looking candidate. Decimal/grouped figures
  // are "strong" rupee signals; long ID-like digit runs (consumer/account no.,
  // 8+ unbroken digits) and excluded values are filtered out so they can't be
  // mistaken for the amount.
  const ex = new Set(exclude.filter(Boolean).map((v) => String(money(v))));
  const cands: { v: number; strong: boolean }[] = [];
  for (const m of t.matchAll(/\b\d[\d,]*\.\d{2}\b/g)) cands.push({ v: money(m[0]), strong: true }); // 1,730.00
  for (const m of t.matchAll(/\b\d{1,2}(?:,\d{2})+,\d{3}\b/g)) cands.push({ v: money(m[0]), strong: true }); // 2,60,440
  for (const m of t.matchAll(/\b\d{3,7}\b/g)) cands.push({ v: money(m[0]), strong: false }); // plain 100–9,999,999
  const valid = cands.filter((c) => c.v >= 100 && c.v <= 50_000_000 && !ex.has(String(c.v)));
  if (!valid.length) return 0;
  const strong = valid.filter((c) => c.strong);
  const pool = strong.length ? strong : valid;
  return Math.max(...pool.map((c) => c.v));
}

function parseConsumerNumber(text: string): string {
  const labelled =
    text.match(/consumer\s*(?:no|number|account)[^0-9]{0,12}(\d[\d\s]{6,16}\d)/i) ||
    text.match(/(?:account|connection|ca)\s*(?:no|number)[^0-9]{0,12}(\d[\d\s]{6,16}\d)/i);
  if (labelled) return labelled[1].replace(/\s/g, '');
  // MSEDCL consumer numbers are 11–12 unbroken digits — a reliable fallback when
  // OCR garbles the label.
  const standalone = text.match(/\b(\d{11,12})\b/);
  return standalone ? standalone[1] : '';
}

// Pick a bill type from the text. `hospitalType` lets us resolve the org's
// hospital-specific variants (e.g. an electricity bill scanned while logged into
// Ayushman becomes `electricity_ayushman`, BSNL landline → `ayushman_landline_bsnl`).
function detectBillType(text: string, hospitalType: string | null = null): UtilityBillType {
  const t = text.toLowerCase();
  const isAyushman = (hospitalType ?? '').toLowerCase().includes('ayushman');

  // Mobile postpaid — check before the generic Airtel/BSNL branches so an Airtel
  // landline or broadband isn't swallowed here.
  if (/airtel/.test(t) && /(postpaid|mobile|my\s*plan)/.test(t)) return 'airtel_postpaid';

  // Electricity — MSEDCL/Mahavitaran and the other discoms.
  if (/electric|mahavitaran|msedcl|mahadiscom|state electricity|\bmseb\b|power\s*bill|energy\s*charge|units?\s*consumed|adani\s*electricity|tata\s*power|torrent\s*power/.test(t)) {
    return isAyushman ? 'electricity_ayushman' : 'electricity';
  }

  // Internet / broadband. "Orange" is a distinct named connection in this org;
  // a backup Orange line is tracked separately.
  if (/\borange\b/.test(t)) return /backup/.test(t) ? 'backup_orange' : 'orange_internet';
  if (/broadband|internet|wi-?fi|fibre|fiber|act\s*fibernet|jiofiber|hathway|tikona|excitel|\bisp\b/.test(t)) return 'wifi';

  // Landline / telephone.
  if (/landline|telephone|\bbsnl\b/.test(t)) {
    if (isAyushman) return 'ayushman_landline_bsnl';
    if (/\bhope\b/.test(t)) return 'hope_landline';
    return 'landline';
  }

  // Maintenance / society / hostel rent (no biller brand — match by place name).
  if (/shrivardhan|maintenance|society\s*charges?/.test(t)) return 'maintenance_shrivardhan';
  if (/automative\s*square/.test(t)) return 'hostel_automative_square';
  if (/mohan\s*nagar/.test(t)) return 'hostel_mohan_nagar';

  return 'other';
}

function detectBiller(text: string): string {
  const t = text.toLowerCase();
  if (/msedcl|mahavitaran|mahadiscom|maharashtra state electricity|\bmseb\b/.test(t)) return 'MSEDCL';
  if (/adani\s*electricity/.test(t)) return 'Adani Electricity';
  if (/tata\s*power/.test(t)) return 'Tata Power';
  if (/torrent\s*power/.test(t)) return 'Torrent Power';
  if (/airtel/.test(t)) return 'Airtel';
  if (/\bbsnl\b/.test(t)) return 'BSNL';
  if (/\bjio\b|jiofiber/.test(t)) return 'Jio';
  if (/\borange\b/.test(t)) return 'Orange';
  if (/act\s*fibernet/.test(t)) return 'ACT Fibernet';
  if (/hathway/.test(t)) return 'Hathway';
  if (/tikona/.test(t)) return 'Tikona';
  if (/excitel/.test(t)) return 'Excitel';
  if (/vodafone|\bidea\b|\bvi\b/.test(t)) return 'Vi';
  return '';
}

export function parseUtilityBill(text: string, hospitalType: string | null = null): ExtractedBill {
  const due_date = parseDueDate(text);
  const consumer_number = parseConsumerNumber(text);
  // Exclude the consumer/account number so it can't be mistaken for the amount.
  const amount = parseAmount(text, [consumer_number]);
  const bill_type = detectBillType(text, hospitalType);
  const biller = detectBiller(text);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Could not read the bill amount. Please enter it manually.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    throw new Error('Could not read the due date. Please enter it manually.');
  }

  const typeLabel: Record<UtilityBillType, string> = {
    electricity: 'Electricity',
    electricity_ayushman: 'Electricity',
    wifi: 'Wi-Fi / Internet',
    orange_internet: 'Internet',
    backup_orange: 'Internet',
    landline: 'Landline',
    hope_landline: 'Landline',
    ayushman_landline_bsnl: 'Landline',
    airtel_postpaid: 'Airtel Postpaid',
    maintenance_shrivardhan: 'Maintenance',
    hostel_automative_square: 'Hostel',
    hostel_mohan_nagar: 'Hostel',
    other: 'Bill',
  };
  const name = biller ? `${typeLabel[bill_type]} — ${biller}` : `${typeLabel[bill_type]} bill`;

  return {
    name,
    bill_type,
    amount,
    due_date,
    consumer_number,
    biller,
  };
}

/**
 * Read a utility-bill photo or PDF entirely in the browser (no API key) and
 * return the parsed payment details. Throws when the amount or due date can't
 * be read — the caller surfaces a toast and lets the user fill them manually.
 *
 * `hospitalType` (the logged-in hospital) is used to resolve the org's
 * hospital-specific bill variants — pass it so an electricity/landline bill maps
 * to the right Ayushman vs Hope entry.
 */
export async function extractUtilityBill(
  file: Blob,
  fileName = '',
  hospitalType: string | null = null,
): Promise<ExtractedBill> {
  const text = await readBillText(file, fileName);
  return parseUtilityBill(text, hospitalType);
}
