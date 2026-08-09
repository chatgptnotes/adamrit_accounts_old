/**
 * Renders a generated discharge summary to a PDF, with or without the hospital
 * logo in the header band.
 *
 * The two variants exist because the portal copy and the patient copy are not
 * the same document: one goes out on hospital letterhead, the other has to be
 * plain. The input is the summary *text* rather than a patient, so the official
 * IPD discharge summary can be fed through the same renderer later.
 *
 * The summary arrives as Markdown - headings, bullets, and a medications table
 * with <br/> inside its dosage cells - so it is rendered as Markdown rather
 * than flattened. A flattened table prints its pipe characters, which is what
 * made the old output look unfinished.
 */

import { maskAadhaar, maskMobile } from "@/utils/aadhaar";

export const stripMarkdownForPdf = (value: string) =>
  value
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .trim();

/**
 * Devanagari is dropped rather than drawn.
 *
 * The summary prompt asks for a Hindi dosage under each English one, and the
 * PDF fonts are jsPDF's built-in Helvetica variants, which have no Devanagari
 * glyphs - so the Hindi came out as strings like "K 2 @ & ? ( . G" on every
 * summary that reached a patient. Embedding a Devanagari font is not enough on
 * its own either: jsPDF does no complex-script shaping, so conjuncts and matras
 * can be placed wrongly, and a misplaced matra in a dosage instruction is worse
 * than no Hindi at all.
 *
 * Until the summary is rendered through a pipeline that shapes Devanagari
 * correctly - the browser's own print path already does - the English dosage
 * stands alone rather than sitting beside a line of noise.
 */
const DEVANAGARI = /[ऀ-ॿ]/;

const dropUnrenderableScripts = (value: string) =>
  value
    .split("\n")
    .filter((line) => !DEVANAGARI.test(line))
    .join("\n");

/** Inline markers only. Block structure is handled by the renderer. */
const stripInlineMarkdown = (value: string) =>
  dropUnrenderableScripts(
    value.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]*)`/g, "$1"),
  ).trim();

/** Logo drawn into the header band, keyed by hospital. Hospitals without an
 *  asset fall back to the text-only header rather than a broken image. */
const HOSPITAL_LOGOS: Record<string, string> = {
  hope: "/hope-hospital-logo-mark.png",
};

/**
 * Full-page letterhead template, keyed by hospital. When present, the
 * with-logo variant paints this image edge to edge on EVERY page — official
 * header, footer, and watermark exactly as printed stationery — and the
 * summary text lives only in the white area between them. A hospital without
 * a template falls back to the drawn header band with the logo mark.
 */
const HOSPITAL_LETTERHEADS: Record<string, string> = {
  hope: "/hope-letterhead.png",
};

/** Where the letterhead's white area is, in mm on A4. Measured from the
 *  hope-letterhead.png artwork: header block ends ~50mm, footer address
 *  strip begins ~260mm. */
const LETTERHEAD_TOP = 52;
const LETTERHEAD_BOTTOM = 254;

export function hospitalLogoSrc(hospitalName: string | null | undefined): string | null {
  return HOSPITAL_LOGOS[String(hospitalName || "").toLowerCase()] ?? null;
}

/** Read a same-origin image into a data URL for jsPDF.addImage. */
async function loadImageDataUrl(src: string): Promise<string> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load ${src}`);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Who signs the document, and what they sign it with.
 *
 * signatureUrl and stampUrl are scans of the real signature and the real
 * hospital stamp. When either is missing the document prints a ruled space for
 * a wet signature instead: a generated mark would be a forgery, and an
 * unsigned-looking document is the honest outcome.
 */
export interface SummarySignatory {
  name: string;
  qualification?: string | null;
  registrationNo?: string | null;
  signatureUrl?: string | null;
  stampUrl?: string | null;
}

export interface ArshiyaSummaryPdfInput {
  summaryText: string;
  withLogo: boolean;
  hospitalName: string;
  patientName: string | null | undefined;
  patientId: string | null | undefined;
  visitNumber: string | null | undefined;
  registrationId: string | null | undefined;
  aadhaarNumber?: string | null;
  mobileNumber?: string | null;
  portalUrl: string;
  /** "DISCHARGE SUMMARY" (default) or "DEATH SUMMARY". */
  documentTitle?: string;
  /** The specialist who treated or operated on the patient. */
  signatory?: SummarySignatory | null;
}

// --- Markdown block model ------------------------------------------------

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

const isTableLine = (line: string) => /^\s*\|.*\|\s*$/.test(line);
const isTableDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

const splitTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell.replace(/<br\s*\/?>/gi, "\n")));

/** Markdown to blocks. Only the constructs the summary prompt asks for. */
function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: "paragraph", text: stripInlineMarkdown(paragraph.join(" ")) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (isTableLine(line)) {
      flushParagraph();
      const tableLines: string[] = [];
      while (i < lines.length && isTableLine(lines[i])) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      const rows = tableLines.filter((l) => !isTableDivider(l)).map(splitTableRow);
      if (rows.length) {
        blocks.push({ kind: "table", head: rows[0], rows: rows.slice(1) });
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: stripInlineMarkdown(heading[2]),
      });
      continue;
    }

    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ kind: "bullet", text: stripInlineMarkdown(bullet[1]) });
      continue;
    }

    // A bold line on its own is a heading in all but syntax.
    const boldOnly = line.match(/^\s*\*\*(.+?)\*\*:?\s*$/);
    if (boldOnly) {
      flushParagraph();
      blocks.push({ kind: "heading", level: 3, text: stripInlineMarkdown(boldOnly[1]) });
      continue;
    }

    paragraph.push(line.trim());
  }
  flushParagraph();
  return blocks;
}

// --- Rendering -----------------------------------------------------------

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 14;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const BODY_TOP = 16;
const BODY_BOTTOM = 274;

const INK = [31, 41, 55] as const;
const MUTED = [107, 114, 128] as const;
const BRAND = [22, 101, 52] as const;
const RULE = [209, 213, 219] as const;
const TINT = [243, 246, 244] as const;

export async function buildArshiyaSummaryPdfBlob(
  input: ArshiyaSummaryPdfInput,
): Promise<Blob> {
  const summary = input.summaryText.trim();
  if (!summary) throw new Error("Generate the discharge summary first.");

  const { default: jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });

  // The letterhead template, when this copy carries the logo and the hospital
  // has one. Loaded once; a failed load falls back to the drawn header so the
  // user still gets their PDF.
  let letterhead: string | null = null;
  if (input.withLogo) {
    const src = HOSPITAL_LETTERHEADS[String(input.hospitalName || "").toLowerCase()];
    if (src) {
      try {
        letterhead = await loadImageDataUrl(src);
      } catch {
        letterhead = null;
      }
    }
  }

  const bodyTop = letterhead ? LETTERHEAD_TOP : BODY_TOP;
  const bodyBottom = letterhead ? LETTERHEAD_BOTTOM : BODY_BOTTOM;
  let y = bodyTop;

  const setInk = (rgb: readonly [number, number, number]) =>
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);

  /** Paint the stationery onto the current page, edge to edge. */
  const paintLetterhead = () => {
    if (letterhead) pdf.addImage(letterhead, "PNG", 0, 0, PAGE_W, PAGE_H);
  };

  /** Every continuation page carries the same template as the first. */
  const newPage = () => {
    pdf.addPage();
    paintLetterhead();
    y = bodyTop;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed <= bodyBottom) return;
    newPage();
  };

  // --- Header -----------------------------------------------------------
  if (letterhead) {
    // The stationery IS the header — nothing is drawn over it. The document
    // title and reference line open the white area instead.
    paintLetterhead();
    setInk(INK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text(input.documentTitle || "DISCHARGE SUMMARY", PAGE_W / 2, bodyTop + 5, { align: "center" });
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    setInk(MUTED);
    pdf.text(
      `Visit ${input.visitNumber || "-"} · ${new Date().toLocaleString()}`,
      PAGE_W / 2,
      bodyTop + 10.5,
      { align: "center" },
    );
    y = bodyTop + 15;
  } else {
    pdf.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
    pdf.rect(0, 0, PAGE_W, 3, "F");

    let textX = MARGIN_X;
    if (input.withLogo) {
      const logoSrc = hospitalLogoSrc(input.hospitalName);
      if (logoSrc) {
        try {
          const dataUrl = await loadImageDataUrl(logoSrc);
          pdf.addImage(dataUrl, "PNG", MARGIN_X, 8, 16, 16);
          textX = MARGIN_X + 20;
        } catch {
          // A missing asset must not cost the user their PDF.
        }
      }
    }

    setInk(INK);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.text(input.hospitalName, textX, 15);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    setInk(MUTED);
    pdf.text((input.documentTitle || "Discharge Summary").replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase()), textX, 21);

    pdf.text(new Date().toLocaleString(), PAGE_W - MARGIN_X, 15, { align: "right" });
    pdf.text(`Visit ${input.visitNumber || "-"}`, PAGE_W - MARGIN_X, 21, { align: "right" });

    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.3);
    pdf.line(MARGIN_X, 26, PAGE_W - MARGIN_X, 26);
    y = 30;
  }

  // --- Patient strip ----------------------------------------------------
  // Identity columns appear only when a value was passed: the same strip
  // prints on advance receipts and radiology reports, which have no business
  // carrying empty identity columns, and a patient with nothing on file gets
  // no blank either. Both numbers are masked to their last four digits —
  // these documents are handed over and posted on.
  const cols = [
    { label: "Patient", value: input.patientName || "-" },
    { label: "Patient ID", value: input.patientId || "-" },
    ...(input.aadhaarNumber
      ? [{ label: "Aadhaar No", value: maskAadhaar(input.aadhaarNumber) }]
      : []),
    ...(input.mobileNumber
      ? [{ label: "Mobile No", value: maskMobile(input.mobileNumber) }]
      : []),
    { label: "Yojana Registration", value: input.registrationId || "-" },
  ];

  // Three to a row. Squeezing five columns across the page turns a patient's
  // name into an ellipsis, which defeats the point of the strip.
  const PER_ROW = 3;
  const rows: (typeof cols)[] = [];
  for (let index = 0; index < cols.length; index += PER_ROW) {
    rows.push(cols.slice(index, index + PER_ROW));
  }

  const stripY = y;
  const ROW_H = 16;
  pdf.setFillColor(TINT[0], TINT[1], TINT[2]);
  pdf.rect(MARGIN_X, stripY, CONTENT_W, ROW_H * rows.length, "F");

  const colW = CONTENT_W / PER_ROW;
  rows.forEach((row, rowIndex) => {
    const rowY = stripY + rowIndex * ROW_H;
    row.forEach((col, index) => {
      const x = MARGIN_X + 4 + index * colW;
      pdf.setFontSize(7);
      setInk(MUTED);
      pdf.setFont("helvetica", "normal");
      pdf.text(col.label.toUpperCase(), x, rowY + 6);
      pdf.setFontSize(10);
      setInk(INK);
      pdf.setFont("helvetica", "bold");
      pdf.text(pdf.splitTextToSize(col.value, colW - 6)[0], x, rowY + 12);
    });
  });

  y = stripY + ROW_H * rows.length + 8;

  // --- Body -------------------------------------------------------------
  for (const block of parseMarkdown(summary)) {
    if (block.kind === "heading") {
      const size = block.level <= 2 ? 12 : 10.5;
      ensureSpace(14);
      y += block.level <= 2 ? 4 : 3;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(size);
      setInk(block.level <= 2 ? BRAND : INK);
      pdf.text(block.text, MARGIN_X, y);
      y += 2;
      if (block.level <= 2) {
        pdf.setDrawColor(BRAND[0], BRAND[1], BRAND[2]);
        pdf.setLineWidth(0.4);
        pdf.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
      }
      y += 5;
      continue;
    }

    if (block.kind === "bullet") {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      setInk(INK);
      const lines = pdf.splitTextToSize(block.text, CONTENT_W - 6) as string[];
      lines.forEach((line, index) => {
        ensureSpace(6);
        if (index === 0) pdf.text("•", MARGIN_X + 1, y);
        pdf.text(line, MARGIN_X + 6, y);
        y += 5;
      });
      y += 1;
      continue;
    }

    if (block.kind === "paragraph") {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9.5);
      setInk(INK);
      const lines = pdf.splitTextToSize(block.text, CONTENT_W) as string[];
      lines.forEach((line) => {
        ensureSpace(6);
        pdf.text(line, MARGIN_X, y);
        y += 5;
      });
      y += 2;
      continue;
    }

    // --- Table ----------------------------------------------------------
    const columnCount = Math.max(block.head.length, ...block.rows.map((r) => r.length));
    const head = [...block.head];
    while (head.length < columnCount) head.push("");

    // Width by the widest content in each column, clamped so one long cell
    // cannot squeeze the rest into unreadable slivers.
    const weights = Array.from({ length: columnCount }, (_, c) => {
      const longest = Math.max(
        head[c]?.length || 1,
        ...block.rows.map((row) =>
          Math.max(...String(row[c] ?? "").split("\n").map((s) => s.length), 1),
        ),
      );
      return Math.min(Math.max(longest, 6), 28);
    });
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((w) => (w / weightTotal) * CONTENT_W);

    const cellLines = (text: string, width: number) =>
      String(text ?? "")
        .split("\n")
        .flatMap((part) => pdf.splitTextToSize(part, width - 4) as string[]);

    const drawHeader = () => {
      const lineSets = head.map((cell, c) => cellLines(cell, widths[c]));
      const height = Math.max(...lineSets.map((l) => l.length)) * 4.4 + 4;
      pdf.setFillColor(BRAND[0], BRAND[1], BRAND[2]);
      pdf.rect(MARGIN_X, y, CONTENT_W, height, "F");
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8.5);
      pdf.setTextColor(255, 255, 255);
      let x = MARGIN_X;
      lineSets.forEach((lines, c) => {
        lines.forEach((line, li) => pdf.text(line, x + 2, y + 5.2 + li * 4.4));
        x += widths[c];
      });
      y += height;
    };

    ensureSpace(26);
    drawHeader();

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    block.rows.forEach((row, rowIndex) => {
      const lineSets = widths.map((w, c) => cellLines(row[c] ?? "", w));
      const height = Math.max(...lineSets.map((l) => l.length)) * 4.4 + 3;

      if (y + height > bodyBottom) {
        newPage();
        drawHeader();
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8.5);
      }

      if (rowIndex % 2 === 1) {
        pdf.setFillColor(249, 250, 251);
        pdf.rect(MARGIN_X, y, CONTENT_W, height, "F");
      }
      setInk(INK);
      let x = MARGIN_X;
      lineSets.forEach((lines, c) => {
        lines.forEach((line, li) => pdf.text(line, x + 2, y + 4.6 + li * 4.4));
        x += widths[c];
      });

      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.1);
      pdf.line(MARGIN_X, y + height, MARGIN_X + CONTENT_W, y + height);
      y += height;
    });
    y += 5;
  }

  // --- Signature and stamp ---------------------------------------------
  await drawSignatureBlock(pdf, input, () => y, (next) => { y = next; }, ensureSpace, {
    bodyTop,
    bodyBottom,
    newPage,
  });

  // --- Footer -----------------------------------------------------------
  // On letterhead the stationery's own footer stands; only a slim reference
  // line goes inside the white area, above it. Plain copies keep the drawn
  // rule-and-portal footer they always had.
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    if (letterhead) {
      pdf.text(`Patient Portal: ${input.portalUrl}`, MARGIN_X, bodyBottom + 4);
      pdf.text(`Page ${page} of ${pageCount}`, PAGE_W - MARGIN_X, bodyBottom + 4, { align: "right" });
    } else {
      pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
      pdf.setLineWidth(0.2);
      pdf.line(MARGIN_X, 284, PAGE_W - MARGIN_X, 284);
      pdf.text(`Patient Portal: ${input.portalUrl}`, MARGIN_X, 289);
      pdf.text(`Page ${page} of ${pageCount}`, PAGE_W - MARGIN_X, 289, { align: "right" });
    }
  }

  return pdf.output("blob") as Blob;
}

/**
 * The signature and stamp that make the document official.
 *
 * A scanned signature or stamp is drawn when the specialist has one on file.
 * Where there is none, a ruled space is printed to be signed and stamped by
 * hand. Nothing is ever drawn to imitate a signature that was not given.
 */
async function drawSignatureBlock(
  pdf: any,
  input: ArshiyaSummaryPdfInput,
  getY: () => number,
  setY: (value: number) => void,
  ensureSpace: (needed: number) => void,
  bounds: { bodyTop: number; bodyBottom: number; newPage: () => void },
) {
  const BLOCK_H = 42;
  ensureSpace(BLOCK_H + 6);
  let y = getY() + 8;
  if (y + BLOCK_H > bounds.bodyBottom) {
    bounds.newPage();
    y = bounds.bodyTop;
  }

  const signatory = input.signatory;
  const columnW = (PAGE_W - MARGIN_X * 2) / 2;
  const stampX = MARGIN_X + columnW + 8;

  // Left: the treating specialist's signature.
  let signed = false;
  if (signatory?.signatureUrl) {
    try {
      const dataUrl = await loadImageDataUrl(signatory.signatureUrl);
      pdf.addImage(dataUrl, "PNG", MARGIN_X, y, 42, 16);
      signed = true;
    } catch {
      // Fall through to the ruled space.
    }
  }
  if (!signed) {
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.3);
    pdf.line(MARGIN_X, y + 16, MARGIN_X + 60, y + 16);
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9.5);
  pdf.setTextColor(INK[0], INK[1], INK[2]);
  pdf.text(signatory?.name || "Treating Consultant", MARGIN_X, y + 21);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  let detailY = y + 26;
  if (signatory?.qualification) {
    pdf.text(signatory.qualification, MARGIN_X, detailY);
    detailY += 4.5;
  }
  if (signatory?.registrationNo) {
    pdf.text(`Reg. No. ${signatory.registrationNo}`, MARGIN_X, detailY);
    detailY += 4.5;
  }
  pdf.text("Signature of the treating specialist", MARGIN_X, detailY);

  // Right: the hospital stamp.
  let stamped = false;
  if (signatory?.stampUrl) {
    try {
      const dataUrl = await loadImageDataUrl(signatory.stampUrl);
      pdf.addImage(dataUrl, "PNG", stampX, y, 32, 32);
      stamped = true;
    } catch {
      // Fall through to the ruled space.
    }
  }
  if (!stamped) {
    pdf.setDrawColor(RULE[0], RULE[1], RULE[2]);
    pdf.setLineWidth(0.3);
    pdf.rect(stampX, y, 34, 30);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7.5);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text("Hospital stamp", stampX + 17, y + 16, { align: "center" });
  }

  setY(y + BLOCK_H);
}
