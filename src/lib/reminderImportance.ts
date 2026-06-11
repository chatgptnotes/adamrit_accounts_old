// Whether a reminder is "important" — i.e. MD/director-level. Combines all three
// signals the team chose: an explicit flag (set in chat or the AI's judgment,
// stored on the row) OR an automatic rule (large amount, or overdue). Directors
// receive only items where this returns true.
export const IMPORTANT_AMOUNT_THRESHOLD = 100_000; // ₹1,00,000

export function isImportant(
  row: { important?: boolean | null; amount?: number | null; due_date?: string | null },
  today: string,
): boolean {
  if (row.important) return true;
  if ((Number(row.amount) || 0) >= IMPORTANT_AMOUNT_THRESHOLD) return true;
  if (row.due_date && today && row.due_date < today) return true; // overdue
  return false;
}
