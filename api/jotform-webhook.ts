import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// JotForm (or any forwarder) -> Task Optimizer bridge.
// Accepts a submission, maps it to a task_optimizer_logs row, and inserts it
// with the Supabase service-role key. AI suggestions are left null so the
// in-app "Generate AI suggestions" button can fill them later.
//
// Auth: a shared secret must match JOTFORM_WEBHOOK_SECRET, supplied either as
// ?secret=... or the x-webhook-secret header.
//
// Payload: either a normalized JSON body { staff_name, designation, tasks,
// hospital_type? }, or JotForm's form post containing a `rawRequest` JSON
// string whose field names contain "name", "designation"/"role", and "task".

// The Supabase project URL is already public (see src/integrations/supabase/client.ts).
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  'https://xvkxccqaopbnkvwgyfjv.supabase.co';

const tasksSchema = z
  .union([z.array(z.string()), z.string()])
  .transform(value =>
    (Array.isArray(value) ? value : value.split(/\r?\n|,/))
      .map(t => t.trim())
      .filter(Boolean),
  );

const normalizedSchema = z.object({
  staff_name: z.string().min(1),
  designation: z.string().min(1),
  tasks: tasksSchema,
  hospital_type: z.string().optional().nullable(),
  user_email: z.string().optional().nullable(),
});

// Input shape of the schema: `tasks` may still be a newline/comma string here.
type NormalizedSubmission = z.input<typeof normalizedSchema>;

// Pull a value from a JotForm rawRequest object by matching key fragments.
function pickByFragment(obj: Record<string, unknown>, fragments: string[]): string | undefined {
  for (const [key, value] of Object.entries(obj)) {
    const k = key.toLowerCase();
    if (fragments.some(f => k.includes(f)) && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

// Map a JotForm rawRequest payload to our normalized shape (best effort).
function fromJotFormRaw(raw: Record<string, unknown>): Partial<NormalizedSubmission> {
  return {
    staff_name: pickByFragment(raw, ['name', 'staff']),
    designation: pickByFragment(raw, ['designation', 'role', 'department']),
    tasks: pickByFragment(raw, ['task', 'duties', 'work']),
    hospital_type: pickByFragment(raw, ['hospital', 'unit', 'branch']),
    user_email: pickByFragment(raw, ['email']),
  };
}

function extractSubmission(body: unknown): unknown {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    // JotForm posts a `rawRequest` JSON string alongside other metadata.
    if (typeof record.rawRequest === 'string') {
      try {
        const raw = JSON.parse(record.rawRequest) as Record<string, unknown>;
        return fromJotFormRaw(raw);
      } catch {
        // fall through to treating the body as already-normalized
      }
    }
  }
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const expectedSecret = process.env.JOTFORM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    res.status(500).json({ error: 'JOTFORM_WEBHOOK_SECRET is not configured.' });
    return;
  }
  const providedSecret =
    (typeof req.query.secret === 'string' ? req.query.secret : undefined) ||
    (typeof req.headers['x-webhook-secret'] === 'string'
      ? (req.headers['x-webhook-secret'] as string)
      : undefined);
  if (providedSecret !== expectedSecret) {
    res.status(401).json({ error: 'Invalid webhook secret.' });
    return;
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY is not configured.' });
    return;
  }

  const parsed = normalizedSchema.safeParse(extractSubmission(req.body));
  if (!parsed.success) {
    res.status(400).json({
      error: 'Could not read submission. Expected staff_name, designation, and tasks.',
      details: parsed.error.flatten().fieldErrors,
    });
    return;
  }

  const submission = parsed.data;
  if (submission.tasks.length === 0) {
    res.status(400).json({ error: 'Submission contained no tasks.' });
    return;
  }

  const supabase = createClient(SUPABASE_URL, serviceRoleKey);
  const { error } = await supabase.from('task_optimizer_logs').insert({
    user_email: submission.user_email ?? 'jotform@webhook',
    hospital_type: submission.hospital_type ?? null,
    staff_name: submission.staff_name,
    designation: submission.designation,
    tasks: submission.tasks,
    ai_suggestions: null,
  });

  if (error) {
    res.status(500).json({ error: 'Failed to save submission.', details: error.message });
    return;
  }

  res.status(200).json({ status: 'ok', tasks: submission.tasks.length });
}
