/**
 * Opens a document stored in Supabase Storage.
 *
 * Supabase serves objects out of a PUBLIC bucket with `Content-Type: text/plain`
 * and `X-Content-Type-Options: nosniff` whenever the file is HTML — a platform
 * rule that stops public buckets being used to host pages, and one the upload's
 * own contentType cannot override. The browser therefore shows the invoice's
 * source code instead of the invoice.
 *
 * Every system-generated invoice (the M.L. Enterprises referral bills among
 * them) is stored as HTML, so they all read as gibberish when opened by URL.
 * Fetching the file and handing the browser a blob of the right type renders it
 * properly, and fixes the invoices already in storage without re-uploading any
 * of them. PDFs and images are unaffected and open directly.
 */

const IS_HTML = /\.html?(?:[?#]|$)/i;

export async function openStoredDocument(url: string): Promise<void> {
  if (!url) throw new Error('This bill has no stored document');

  if (!IS_HTML.test(url)) {
    window.open(url, '_blank', 'noopener');
    return;
  }

  // Opened before the await: a window opened after an async gap is treated as
  // unsolicited and blocked.
  const win = window.open('', '_blank');
  if (!win) throw new Error('Allow pop-ups for this site to view the invoice');
  win.document.write('<!doctype html><title>Loading invoice…</title>');

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The invoice could not be loaded (${response.status})`);
    const html = await response.text();
    win.document.open();
    win.document.write(html);
    win.document.close();
  } catch (error) {
    win.close();
    throw error;
  }
}
