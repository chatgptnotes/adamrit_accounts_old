import { toast } from 'sonner';

/**
 * Tally's Alt+E (Export) and Alt+M (E-mail) for the report screens.
 *
 * A report opts in by returning its rows from `useTallyReport`'s `exportData`.
 * Screens that have not opted in draw both buttons greyed, the way Tally greys
 * an action a screen cannot perform.
 */

export interface ReportExport {
  /** Becomes the file name and the sheet name */
  title: string;
  columns: string[];
  rows: (string | number | null | undefined)[][];
  /** The period caption Tally prints under a report title */
  period?: string;
}

const safeName = (title: string): string => title.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'report';

/**
 * Alt+E — an .xlsx of the report as it stands, filters and all.
 *
 * `xlsx` is already in the bundle for the account logs, but it is a large
 * dependency, so it is loaded only when someone actually exports.
 */
export async function exportReport({ title, columns, rows, period }: ReportExport): Promise<void> {
  if (rows.length === 0) {
    toast.info('Nothing to export — this report has no rows');
    return;
  }
  try {
    const XLSX = await import('xlsx');
    const sheet = XLSX.utils.aoa_to_sheet([
      [title],
      ...(period ? [[period]] : []),
      [],
      columns,
      ...rows.map((row) => row.map((cell) => cell ?? '')),
    ]);
    const book = XLSX.utils.book_new();
    // Excel refuses a sheet name over 31 characters or containing []:*?/\
    XLSX.utils.book_append_sheet(book, sheet, title.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
    XLSX.writeFile(book, `${safeName(title)}.xlsx`);
    toast.success(`${title} exported`);
  } catch (error) {
    console.error('Export failed:', error);
    toast.error('Could not build the export file');
  }
}

/** The report as a plain-text table, for the body of an e-mail. */
const asText = ({ title, columns, rows, period }: ReportExport): string => {
  const all = [columns, ...rows.map((row) => row.map((cell) => String(cell ?? '')))];
  const widths = columns.map((_, i) => Math.max(...all.map((row) => String(row[i] ?? '').length)));
  const line = (row: (string | number | null | undefined)[]) =>
    row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ');
  return [title, period ?? '', '', line(columns), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)].join(
    '\n',
  );
};

/**
 * Alt+M — Tally attaches the report to an e-mail. A browser cannot attach a
 * file to a `mailto:`, so the report goes in the body and the spreadsheet is
 * downloaded alongside it for the sender to attach.
 */
export async function emailReport(data: ReportExport): Promise<void> {
  if (data.rows.length === 0) {
    toast.info('Nothing to e-mail — this report has no rows');
    return;
  }
  const body = asText(data);
  // mailto: has no formal limit but breaks in practice well before this; long
  // reports travel as the downloaded file instead.
  const trimmed = body.length > 1800 ? `${body.slice(0, 1800)}\n…\n(full report attached — see the downloaded file)` : body;
  await exportReport(data);
  window.location.href = `mailto:?subject=${encodeURIComponent(data.title)}&body=${encodeURIComponent(trimmed)}`;
  toast.info('Attach the downloaded file — a browser cannot attach it for you');
}
