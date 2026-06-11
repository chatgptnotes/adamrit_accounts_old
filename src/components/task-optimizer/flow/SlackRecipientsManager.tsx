// Reminder recipients manager — a small CRUD modal over slack_recipients. Lets
// the team maintain the roster of people/channels a deadline reminder can be
// addressed to (used by the Skill Factory chatbot's "send to Murli sir" flow and
// the firing crons). Self-contained: renders its own trigger button + modal.
import { useState } from 'react';
import { Users, X, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { useSlackRecipients, type UpsertSlackRecipient } from '@/hooks/useSlackRecipients';
import type { SlackRecipient, SlackRecipientKind } from '@/lib/slackRecipients';

interface FormState {
  id: string | null;
  name: string;
  aliases: string; // comma-separated in the UI
  slack_target: string;
  kind: SlackRecipientKind;
  active: boolean;
  is_director: boolean;
}

const emptyForm = (): FormState => ({
  id: null,
  name: '',
  aliases: '',
  slack_target: '',
  kind: 'dm',
  active: true,
  is_director: false,
});

export default function SlackRecipientsManager({ variant = 'dark' }: { variant?: 'dark' | 'light' }) {
  const [open, setOpen] = useState(false);
  const { recipients, isLoading, error, createRecipient, updateRecipient, deleteRecipient, isSaving } =
    useSlackRecipients();
  const [form, setForm] = useState<FormState>(emptyForm());

  const isEditing = form.id !== null;
  const canSave = form.name.trim().length > 0;
  const saving = isSaving;

  const startEdit = (r: SlackRecipient) =>
    setForm({
      id: r.id,
      name: r.name,
      aliases: r.aliases.join(', '),
      slack_target: r.slack_target ?? '',
      kind: r.kind,
      active: r.active,
      is_director: r.is_director,
    });

  const reset = () => setForm(emptyForm());

  const onSubmit = async () => {
    if (!canSave) return;
    const payload: UpsertSlackRecipient = {
      name: form.name.trim(),
      aliases: form.aliases
        .split(',')
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean),
      slack_target: form.slack_target.trim() || null,
      kind: form.kind,
      active: form.active,
      is_director: form.is_director,
    };
    try {
      if (form.id) await updateRecipient({ id: form.id, ...payload });
      else await createRecipient(payload);
      reset();
    } catch {
      /* hook already toasted */
    }
  };

  const onDelete = async (r: SlackRecipient) => {
    if (!window.confirm(`Remove "${r.name}" from the recipient list?`)) return;
    try {
      await deleteRecipient(r.id);
      if (form.id === r.id) reset();
    } catch {
      /* hook toasted */
    }
  };

  const triggerCls =
    variant === 'dark'
      ? 'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 ring-1 ring-white/15 text-white'
      : 'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700';

  return (
    <>
      <button onClick={() => setOpen(true)} className={triggerCls} title="Reminder recipients">
        <Users className="w-3.5 h-3.5" /> Recipients
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 sticky top-0 bg-white">
              <Users className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">Reminder recipients</h2>
              <button onClick={() => setOpen(false)} className="ml-auto p-1 rounded-md text-slate-400 hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-slate-500">
                People or channels a reminder can be sent to. <code className="bg-slate-100 px-1 rounded">slack_target</code>{' '}
                = the Slack member ID (U…) or channel ID (C…); leave blank to address by name only.
              </p>

              {/* ── Add / edit form ── */}
              <div className={`rounded-lg border p-3 ${isEditing ? 'border-blue-300 ring-2 ring-blue-200' : 'border-slate-200'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {isEditing ? <Pencil className="w-3.5 h-3.5 text-blue-600" /> : <Plus className="w-3.5 h-3.5 text-blue-600" />}
                  <span className="text-xs font-semibold text-slate-800">{isEditing ? 'Edit recipient' : 'Add recipient'}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Name, e.g. Murli sir"
                    className="text-sm px-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    value={form.aliases}
                    onChange={(e) => setForm({ ...form, aliases: e.target.value })}
                    placeholder="Aliases (comma sep): murli, murali"
                    className="text-sm px-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    value={form.slack_target}
                    onChange={(e) => setForm({ ...form, slack_target: e.target.value })}
                    placeholder="Slack ID (U… or C…)"
                    className="text-sm px-2.5 py-1.5 rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <select
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value as SlackRecipientKind })}
                    className="text-sm px-2.5 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="dm">Person (DM)</option>
                    <option value="channel">Channel</option>
                  </select>
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-700 select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.is_director}
                    onChange={(e) => setForm({ ...form, is_director: e.target.checked })}
                    className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  MD / director
                  <span className="text-[10px] text-slate-400">(only gets important items + a daily summary)</span>
                </label>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => void onSubmit()}
                    disabled={!canSave || saving}
                    className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {isEditing ? 'Save' : 'Add'}
                  </button>
                  {isEditing && (
                    <button onClick={reset} className="text-sm px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50">
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* ── List ── */}
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {isLoading && (
                  <div className="flex items-center gap-2 px-3 py-4 text-sm text-slate-500">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                  </div>
                )}
                {!isLoading && error && (
                  <div className="px-3 py-4 text-sm text-red-600">
                    Could not load recipients. The <code className="bg-red-50 px-1 rounded">slack_recipients</code> table may
                    not exist yet — run the migration in Supabase.
                  </div>
                )}
                {!isLoading && !error && recipients.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-slate-500">No recipients yet. Add one above.</div>
                )}
                {recipients.map((r) => (
                  <div key={r.id} className="group flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {r.kind === 'channel' ? `# ${r.name}` : r.name}
                        {r.is_director && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
                            MD
                          </span>
                        )}
                        {!r.active && <span className="ml-2 text-[10px] text-slate-400">(inactive)</span>}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {r.slack_target ? r.slack_target : 'name-only (no Slack ID)'}
                        {r.aliases.length > 0 && ` · ${r.aliases.join(', ')}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => startEdit(r)} title="Edit" className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void onDelete(r)}
                        title="Remove"
                        className="p-1.5 rounded-md text-slate-500 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
