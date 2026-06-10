// Natural-language → concrete utility_deadlines row. Used by the Skill Factory
// chatbot to turn prompts like "remind me to pay the Airtel bill tomorrow ₹2000"
// into an actual reminder row + notification, instead of an abstract automation
// on the canvas.
import { geminiGenerateContentUrl, geminiFetch, GEMINI_MODEL_LITE } from '@/lib/gemini';
import { LLM_BACKEND, callVpsClaude } from '@/lib/vpsClaude';
import type { UpsertUtilityDeadline, UtilityBillType } from '@/hooks/useUtilityDeadlines';

const BILL_TYPES: UtilityBillType[] = [
  'wifi',
  'landline',
  'electricity',
  'airtel_postpaid',
  'electricity_ayushman',
  'orange_internet',
  'hope_landline',
  'backup_orange',
  'ayushman_landline_bsnl',
  'maintenance_shrivardhan',
  'hostel_automative_square',
  'hostel_mohan_nagar',
  'other',
];

export interface ParsedReminder extends UpsertUtilityDeadline {
  // Echo back the resolved date as a friendly label so the chat bubble can say
  // "Due tomorrow (Jun 9, 2026)" instead of just the ISO string.
  dueLabel: string;
}

// Fast, local intent gate — answers "should I even call Gemini?" before
// spending a round-trip. Conservatively true only when the prompt clearly
// asks the system to CREATE a reminder/bill, not when it asks to DESIGN an
// automation about reminders. False positives leak into the parser which then
// returns null (Gemini overrides), so the worst case is one wasted call.
export function looksLikeCreateReminder(prompt: string): boolean {
  const p = prompt.toLowerCase().trim();
  if (!p) return false;
  // "build/design/notify me when … is added" → automation-design, not create.
  if (/\b(automation|workflow|trigger|when .+ is added|when .+ becomes|escalate|notify (the )?supervisor)\b/.test(p)) {
    return false;
  }
  // Positive signals: explicit reminder/bill creation verbs.
  return (
    /\bremind(er)?\b/.test(p) ||
    /\b(add|create|set|make|new|schedule)\b.*\b(bill|reminder|deadline|payment)\b/.test(p) ||
    /\bpay\b.*\b(by|on|tomorrow|today|next)\b/.test(p)
  );
}

// Resolve a date hint emitted by Gemini ("today", "tomorrow", "in_3_days",
// "2026-06-15", "next_monday") into a YYYY-MM-DD string. Done client-side so
// the date math is deterministic and not at the mercy of model timezone drift.
function resolveDueDate(hint: string | undefined): { iso: string; label: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const labelFor = (d: Date, fallback: string) => {
    const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    if (diff === 0) return `today (${toIso(d)})`;
    if (diff === 1) return `tomorrow (${toIso(d)})`;
    if (diff > 1 && diff <= 7) return `in ${diff} days (${toIso(d)})`;
    return fallback || toIso(d);
  };

  const h = (hint ?? '').toLowerCase().trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(h)) {
    const [y, m, d] = h.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return { iso: toIso(date), label: labelFor(date, h) };
  }

  if (h === 'today') return { iso: toIso(today), label: `today (${toIso(today)})` };

  if (h === 'tomorrow') {
    const t = new Date(today);
    t.setDate(t.getDate() + 1);
    return { iso: toIso(t), label: `tomorrow (${toIso(t)})` };
  }

  const inN = h.match(/^in_(\d+)_days?$/);
  if (inN) {
    const n = Math.max(1, Math.min(365, Number(inN[1])));
    const t = new Date(today);
    t.setDate(t.getDate() + n);
    return { iso: toIso(t), label: labelFor(t, `in ${n} days`) };
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const nextDay = h.match(/^next_(\w+)$/);
  if (nextDay) {
    const idx = weekdays.indexOf(nextDay[1]);
    if (idx !== -1) {
      const t = new Date(today);
      const diff = ((idx - t.getDay() + 7) % 7) || 7;
      t.setDate(t.getDate() + diff);
      return { iso: toIso(t), label: labelFor(t, `next ${nextDay[1]}`) };
    }
  }

  // Fallback: 3 days out — better than failing the insert, since the user can
  // edit the date in the deadlines table afterward.
  const t = new Date(today);
  t.setDate(t.getDate() + 3);
  return { iso: toIso(t), label: `in 3 days (${toIso(t)})` };
}

interface RawReminder {
  name?: string;
  bill_type?: string;
  due_hint?: string;
  amount?: number | string;
  recurring?: boolean;
  notes?: string | null;
}

function buildPrompt(instruction: string, todayIso: string): string {
  return `You extract a single utility-bill reminder from the user's request.

Today's date: ${todayIso}.

User's request: ${instruction}

Return ONLY valid JSON (no markdown) of exactly this shape:
{
  "name": "short human label, e.g. 'Airtel postpaid bill' or 'Pay rent to Mr. Sharma'",
  "bill_type": "one of: ${BILL_TYPES.join(', ')}",
  "due_hint": "one of: today | tomorrow | in_N_days (N is an integer) | next_<weekday> | YYYY-MM-DD",
  "amount": numeric amount in INR (0 if not mentioned),
  "recurring": true if the user said monthly/every month/recurring, else false,
  "notes": "any extra context the user gave, else null"
}

Rules:
- Pick the most specific bill_type if the user named a service (wifi, electricity, Airtel postpaid, etc.). Use 'other' if unclear.
- If the user said "tomorrow" return "tomorrow"; "today" → "today"; "in 3 days" → "in_3_days"; an actual date → ISO YYYY-MM-DD.
- Keep the name SHORT — like a calendar entry, not a sentence. Include the particular name/vendor if the user gave one (e.g. "Pay Sharma electricity bill").
- Output a single valid JSON object.`;
}

// Returns null when the prompt doesn't actually describe a create-reminder
// request. Callers should fall back to the automation-design flow in that
// case. Throws only on infrastructure failures (missing key, AI unreachable).
export async function parseReminderFromPrompt(instruction: string): Promise<ParsedReminder | null> {
  if (!instruction.trim()) return null;
  if (!looksLikeCreateReminder(instruction)) return null;

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let text: string;
  if (LLM_BACKEND === 'vps') {
    // No fallback: VPS failure throws, caller surfaces error in chat UI.
    text = await callVpsClaude(buildPrompt(instruction, todayIso));
  } else {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key is not configured.');
    let response: Response;
    try {
      response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(instruction, todayIso) }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 400 },
        }),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('429') || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
        throw new Error('The AI service is rate-limited or out of quota. Please try again shortly.');
      }
      throw new Error('Could not reach the AI service. Please try again.');
    }
    const data = await response.json();
    text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let parsed: RawReminder;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return null;
    }
  }

  const name = (parsed.name ?? '').toString().trim();
  if (!name) return null;

  const billTypeRaw = (parsed.bill_type ?? '').toString().trim() as UtilityBillType;
  const bill_type: UtilityBillType = BILL_TYPES.includes(billTypeRaw) ? billTypeRaw : 'other';

  const amountNum = typeof parsed.amount === 'number' ? parsed.amount : Number(parsed.amount ?? 0);
  const amount = Number.isFinite(amountNum) && amountNum >= 0 ? amountNum : 0;

  const { iso, label } = resolveDueDate(parsed.due_hint);

  return {
    name,
    bill_type,
    amount,
    due_date: iso,
    recurring: parsed.recurring === true,
    notes: parsed.notes ? String(parsed.notes).trim() : null,
    dueLabel: label,
  };
}

// ── Multi-reminder parser ────────────────────────────────────────────
// Used by the notification-bell AI assistant. Handles prompts that bundle
// several bills in one sentence, e.g.
//   "one week from now I have to pay 1000, 23434, 3224 to electric, water, solar"
// Pairs amounts to vendors positionally and returns one reminder per pair.
function buildBulkPrompt(instruction: string, todayIso: string): string {
  return `You extract a LIST of utility-bill reminders from the user's request.

Today's date: ${todayIso}.

User's request: ${instruction}

Return ONLY a valid JSON array (no markdown, no prose). Each element of the
array is a reminder of exactly this shape:
{
  "name": "short human label (e.g. 'Electricity bill', 'Water bill', 'Solar bill')",
  "bill_type": "one of: ${BILL_TYPES.join(', ')}",
  "due_hint": "one of: today | tomorrow | in_N_days | next_<weekday> | YYYY-MM-DD",
  "amount": numeric amount in INR (0 if not mentioned),
  "recurring": true if the user said monthly/every month/recurring, else false,
  "notes": "any extra context the user gave, else null"
}

Rules:
- If the user lists several amounts and several vendors in one sentence, pair
  them positionally (first amount → first vendor, etc.) and emit one reminder
  per pair.
- Pick the most specific bill_type per vendor. "electric/electricity/power" →
  "electricity"; "internet/wifi" → "wifi"; anything unclear → "other".
- All reminders in the list share the same due date unless the user said
  otherwise. "One week from now" → "in_7_days"; "tomorrow" → "tomorrow"; etc.
- Keep each name SHORT — calendar-entry style.
- If the prompt only describes ONE reminder, return a single-element array.
- Output a single valid JSON array. No markdown fences, no commentary.`;
}

export async function parseRemindersFromPrompt(
  instruction: string,
): Promise<ParsedReminder[]> {
  if (!instruction.trim()) return [];

  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key is not configured.');

  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let response: Response;
  try {
    response = await geminiFetch(geminiGenerateContentUrl(apiKey, GEMINI_MODEL_LITE), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildBulkPrompt(instruction, todayIso) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 800 },
      }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('429') || /quota|RESOURCE_EXHAUSTED/i.test(message)) {
      throw new Error('The AI service is rate-limited or out of quota. Please try again shortly.');
    }
    throw new Error('Could not reach the AI service. Please try again.');
  }

  const data = await response.json();
  const text: string = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  let rawList: RawReminder[];
  try {
    const parsed = JSON.parse(cleaned);
    rawList = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      const arr = JSON.parse(match[0]);
      rawList = Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }

  const reminders: ParsedReminder[] = [];
  for (const raw of rawList) {
    const name = (raw?.name ?? '').toString().trim();
    if (!name) continue;
    const billTypeRaw = (raw?.bill_type ?? '').toString().trim() as UtilityBillType;
    const bill_type: UtilityBillType = BILL_TYPES.includes(billTypeRaw) ? billTypeRaw : 'other';
    const amountNum = typeof raw?.amount === 'number' ? raw.amount : Number(raw?.amount ?? 0);
    const amount = Number.isFinite(amountNum) && amountNum >= 0 ? amountNum : 0;
    const { iso, label } = resolveDueDate(raw?.due_hint);
    reminders.push({
      name,
      bill_type,
      amount,
      due_date: iso,
      recurring: raw?.recurring === true,
      notes: raw?.notes ? String(raw.notes).trim() : null,
      dueLabel: label,
    });
  }
  return reminders;
}
