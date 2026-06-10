import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  User,
  Send,
  Search,
  Boxes,
  LayoutTemplate,
  BarChart3,
  Settings as SettingsIcon,
  Play,
  Sparkles,
  FileText,
  Camera,
  Pill,
  TestTube,
  ClipboardList,
  GitBranch,
  GripVertical,
  UserPlus,
  Plus,
  Trash2,
  ExternalLink,
  CheckCircle2,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { geminiGenerateContentUrl, geminiFetch } from '@/lib/gemini';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

// ── Skill Factory data ──────────────────────────────────────────────────────
// Subagents are stored per-user in Supabase (table: skill_factory_subagents).
// Each subagent bundles the rules that feed it and the workflow it produces.
// The DEFAULT_SUBAGENTS below seed a brand-new user's account on first load and
// also serve as an offline fallback if the table hasn't been created yet.

interface WorkflowNode {
  label: string;
  type: 'step' | 'decision' | 'output';
}

// A rule maps an uploaded photo to a document, and carries its OWN workflow —
// the simple, automatable steps the "Head of Hospital" AI designs for it.
interface Rule {
  id: string;
  trigger: string; // e.g. "Photo A"
  action: string; // e.g. "Admission note"
  workflow: WorkflowNode[];
}

interface Subagent {
  id: string;
  name: string;
  description: string;
  icon: string; // key into ICON_MAP (icons can't be stored in the DB)
  rules: Rule[];
  // Legacy: the workflow used to live on the subagent. Kept only so the DB
  // column still round-trips; the authoritative workflow now lives per-rule.
  workflow: WorkflowNode[];
}

// Icon keys persist as plain strings; this map resolves them back to components.
const ICON_MAP: Record<string, typeof FileText> = {
  file: FileText,
  clipboard: ClipboardList,
  test: TestTube,
  pill: Pill,
  camera: Camera,
  box: Boxes,
};
const iconFor = (key: string) => ICON_MAP[key] ?? Boxes;

const DEFAULT_SUBAGENTS: Omit<Subagent, 'id'>[] = [
  {
    name: 'Discharge',
    description: 'Discharge document agent',
    icon: 'file',
    workflow: [],
    rules: [
      {
        id: 'r1',
        trigger: 'Photo A',
        action: 'Admission note',
        workflow: [
          { label: 'Read admission note photo', type: 'step' },
          { label: 'Extract diagnosis & history', type: 'step' },
          { label: 'Save to patient record', type: 'output' },
        ],
      },
      {
        id: 'r2',
        trigger: 'Photo B',
        action: "Doctor's discharge note",
        workflow: [
          { label: "Read doctor's discharge note", type: 'step' },
          { label: 'Doctor approval', type: 'decision' },
          { label: 'Generate discharge summary', type: 'output' },
        ],
      },
    ],
  },
  {
    name: 'IPD Registration',
    description: 'Admission intake agent',
    icon: 'clipboard',
    workflow: [],
    rules: [
      {
        id: 'r1',
        trigger: 'Photo A',
        action: 'Aadhaar / ID card',
        workflow: [
          { label: 'Read ID card photo', type: 'step' },
          { label: 'Extract name & ID number', type: 'step' },
          { label: 'Create patient record', type: 'output' },
        ],
      },
      {
        id: 'r2',
        trigger: 'Photo B',
        action: 'Referral letter',
        workflow: [
          { label: 'Read referral letter', type: 'step' },
          { label: 'Attach to IPD visit', type: 'output' },
        ],
      },
    ],
  },
  {
    name: 'Lab Orders',
    description: 'Diagnostics & reports agent',
    icon: 'test',
    workflow: [],
    rules: [
      {
        id: 'r1',
        trigger: 'Photo A',
        action: 'Doctor order sheet',
        workflow: [
          { label: 'Read order sheet', type: 'step' },
          { label: 'Map to lab tests', type: 'step' },
          { label: 'Create lab order', type: 'output' },
        ],
      },
    ],
  },
  {
    name: 'Pharmacy',
    description: 'Dispense & inventory agent',
    icon: 'pill',
    workflow: [],
    rules: [
      {
        id: 'r1',
        trigger: 'Photo A',
        action: 'Prescription',
        workflow: [
          { label: 'Read prescription', type: 'step' },
          { label: 'Check stock', type: 'decision' },
          { label: 'Create sale bill', type: 'output' },
        ],
      },
    ],
  },
  {
    name: 'Radiology',
    description: 'Imaging agent',
    icon: 'camera',
    workflow: [],
    rules: [
      {
        id: 'r1',
        trigger: 'Photo A',
        action: 'Imaging request',
        workflow: [
          { label: 'Read request', type: 'step' },
          { label: 'Schedule scan', type: 'output' },
        ],
      },
    ],
  },
];

// ── Per-user persistence (Supabase) ──────────────────────────────────────────
// Custom-auth app pattern: anon key, RLS disabled, scoped at the query layer by
// the logged-in user's email. Falls back to in-memory defaults if the table is
// missing so the page never hard-fails before the migration is run.
const TABLE = 'skill_factory_subagents';

interface SubagentRow {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  rules: (Partial<Rule> & { id: string; trigger: string; action: string })[] | null;
  workflow: WorkflowNode[] | null;
}

// Bring rules into the per-rule-workflow shape. Older rows stored the workflow at
// the subagent level; if a rule has none and the subagent does, the subagent
// workflow is moved onto the first rule (one-time, no SQL migration needed).
const normalizeRules = (
  rawRules: SubagentRow['rules'],
  subagentWorkflow: WorkflowNode[] | null,
): Rule[] => {
  const rules: Rule[] = (Array.isArray(rawRules) ? rawRules : []).map((r) => ({
    id: r.id,
    trigger: r.trigger,
    action: r.action,
    workflow: Array.isArray(r.workflow) ? r.workflow : [],
  }));
  if (
    rules.length > 0 &&
    rules[0].workflow.length === 0 &&
    Array.isArray(subagentWorkflow) &&
    subagentWorkflow.length > 0
  ) {
    rules[0] = { ...rules[0], workflow: subagentWorkflow };
  }
  return rules;
};

const rowToSubagent = (r: SubagentRow): Subagent => ({
  id: r.id,
  name: r.name,
  description: r.description ?? '',
  icon: r.icon ?? 'box',
  rules: normalizeRules(r.rules, r.workflow),
  workflow: Array.isArray(r.workflow) ? r.workflow : [],
});

const NAV = [
  { id: 'subagents', label: 'My Subagents', icon: Boxes },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'insights', label: 'Insights', icon: BarChart3 },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;

// ── AI Assistant (Gemini) ────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

// Hard ceiling on steps per workflow. The "Head of Hospital" splits anything
// bigger into multiple smaller skills.
const MAX_STEPS = 5;
const VALID_TYPES = new Set<WorkflowNode['type']>(['step', 'decision', 'output']);

// The AI commits a workflow by appending one fenced ```skillfactory``` block of
// JSON. Anything outside the block is normal prose the user reads.
const SKILL_FENCE = /```skillfactory\s*([\s\S]*?)```/i;

interface SkillWorkflow {
  kind: 'workflow';
  workflow: WorkflowNode[];
}
interface SkillBreakdown {
  kind: 'breakdown';
  rules: { trigger: string; action: string; workflow: WorkflowNode[] }[];
}
type ParsedSkill = SkillWorkflow | SkillBreakdown;

// Pull the fenced block out of a reply: `display` is the prose the user sees,
// `payload` is the parsed JSON (or null if absent/malformed).
function extractSkillBlock(raw: string): { display: string; payload: unknown } {
  const match = raw.match(SKILL_FENCE);
  if (!match) return { display: raw.trim(), payload: null };
  const display = raw.replace(match[0], '').trim();
  let payload: unknown = null;
  try {
    payload = JSON.parse(match[1].trim());
  } catch {
    payload = null;
  }
  return { display, payload };
}

// Keep only valid nodes, coerce unknown types to 'step', cap at MAX_STEPS.
function clampWorkflow(nodes: unknown): WorkflowNode[] | null {
  if (!Array.isArray(nodes)) return null;
  const cleaned = nodes
    .filter((n): n is { label: unknown; type?: unknown } => !!n && typeof n === 'object')
    .map((n) => ({
      label: typeof n.label === 'string' ? n.label.trim() : '',
      type: VALID_TYPES.has(n.type as WorkflowNode['type'])
        ? (n.type as WorkflowNode['type'])
        : ('step' as const),
    }))
    .filter((n) => n.label.length > 0)
    .slice(0, MAX_STEPS);
  return cleaned.length > 0 ? cleaned : null;
}

function validateSkill(payload: unknown): ParsedSkill | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.kind === 'workflow') {
    const wf = clampWorkflow(p.workflow);
    return wf ? { kind: 'workflow', workflow: wf } : null;
  }
  if (p.kind === 'breakdown' && Array.isArray(p.rules)) {
    const rules = p.rules
      .slice(0, 6)
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => {
        const wf = clampWorkflow(r.workflow);
        const trigger = typeof r.trigger === 'string' ? r.trigger.trim() : '';
        const action = typeof r.action === 'string' ? r.action.trim() : '';
        return wf && trigger && action ? { trigger, action, workflow: wf } : null;
      })
      .filter((r): r is SkillBreakdown['rules'][number] => r !== null);
    return rules.length > 0 ? { kind: 'breakdown', rules } : null;
  }
  return null;
}

// The "Head of Hospital" skill — a veteran ops chief who knows how every job is
// done and turns a rule into the simplest automatable workflow (or splits it).
function buildHeadOfHospitalPrompt(agent: Subagent, rule: Rule | null): string {
  const existing = agent.rules.map((r) => `${r.trigger} → ${r.action}`).join('; ');
  const ruleLine = rule
    ? `"${rule.trigger} → ${rule.action}"${rule.workflow.length ? ` (currently ${rule.workflow.length} steps)` : ' (no steps yet)'}`
    : 'none selected — ask the user to pick or describe a rule first';
  return `You are the "Head of Hospital" — a veteran hospital operations chief at Hope Hospital and Ayushman Hospital (Nagpur, India). You know, in concrete detail, how every job in the hospital is actually done: reception, IPD/OPD registration, nursing, doctor notes, discharge, pharmacy dispensing, lab and radiology orders, billing, and Ayushman/PMJAY scheme paperwork.

You work inside "Skill Factory", a no-code tool where staff turn a photo-driven RULE into an automatable workflow. The user is building one rule and wants you to design the workflow that runs when it fires.

HOW YOU WORK
1. Understand first. If the task is at all ambiguous, ask 1-3 SHORT, relevant clarifying questions BEFORE designing (who uploads the photo, what document it is, what the output should be, who approves). While you are still asking, send NO code block.
2. Once you have enough, design the SIMPLEST workflow a computer could run, step by step.

THE 5-STEP LAW
A workflow you output must have AT MOST ${MAX_STEPS} steps. Keep each step concrete and automatable. Use exactly these node types: "step" (a normal action), "decision" (a yes/no or branch), "output" (the final artifact — a note, bill, order, summary).

THE BREAKDOWN LAW
If the task genuinely needs more than ${MAX_STEPS} steps, do NOT cram it. Split it into 2-3 smaller rules ("skills"), each a self-contained ${MAX_STEPS}-steps-or-fewer workflow, chained so one rule's output feeds the next rule's trigger. Prefer several small skills over one big one. We only automate SIMPLE workflows for now.

OUTPUT PROTOCOL (critical)
When — and only when — you are ready to commit, write one or two short human sentences, then append EXACTLY ONE fenced code block tagged "skillfactory" containing JSON. Never put commentary inside the JSON. Two allowed shapes:
\`\`\`skillfactory
{"kind":"workflow","workflow":[{"label":"...","type":"step"},{"label":"...","type":"output"}]}
\`\`\`
\`\`\`skillfactory
{"kind":"breakdown","rules":[{"trigger":"...","action":"...","workflow":[{"label":"...","type":"step"}]}]}
\`\`\`
JSON rules: every workflow has 1-${MAX_STEPS} nodes; every type is step|decision|output; breakdown has 1-6 rules. If you are still asking a question, send NO code block.

CURRENT CONTEXT
- Subagent: "${agent.name}" — ${agent.description}
- Rule being designed: ${ruleLine}
- Existing rules in this subagent: ${existing || 'none yet'}
Keep everything practical for a busy Indian hospital. Be concise.`;
}

// A workflow step as an editable, draggable row: a name plus an assigned person.
interface WorkflowRow {
  id: string;
  label: string;
  type: WorkflowNode['type'];
  assignee: string; // '' = unassigned
}

const UNASSIGNED = '';

export default function SkillFactory() {
  const { user } = useAuth();
  const userEmail = user?.email ?? '';
  const navigate = useNavigate();

  const [activeNav, setActiveNav] = useState<(typeof NAV)[number]['id']>('subagents');
  const [search, setSearch] = useState('');

  // Per-user subagents, loaded from Supabase (or in-memory defaults as fallback).
  const [subagents, setSubagents] = useState<Subagent[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  // The rule whose workflow is shown/edited in the Workflow column.
  const [activeRuleId, setActiveRuleId] = useState<string>('');
  const [loadingAgents, setLoadingAgents] = useState(true);
  // True once we've confirmed the DB table is reachable; when false, the +
  // buttons still work but changes live only in memory for this session.
  const [persist, setPersist] = useState(false);

  // People that workflow rows can be assigned to. Editable — new people added
  // from any row's dropdown appear in every row.
  const [people, setPeople] = useState<string[]>([
    'Dr. Sharma',
    'Nurse Priya',
    'Reception Desk',
    'Billing Desk',
  ]);
  // The draggable workflow rows for the selected subagent.
  const [rows, setRows] = useState<WorkflowRow[]>([]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = subagents.find((s) => s.id === activeId);
  const activeRule = active?.rules.find((r) => r.id === activeRuleId) ?? null;
  const filtered = subagents.filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  // Load this user's subagents on mount. Seeds the defaults the first time a
  // user has none; falls back to in-memory defaults if the table is missing.
  useEffect(() => {
    let cancelled = false;

    const useDefaults = (canPersist: boolean) => {
      const seeded = DEFAULT_SUBAGENTS.map((s, i) => ({ ...s, id: `default-${i}` }));
      if (cancelled) return;
      setSubagents(seeded);
      setActiveId(seeded[0]?.id ?? '');
      setPersist(canPersist);
      setLoadingAgents(false);
    };

    const load = async () => {
      setLoadingAgents(true);
      // Not logged in (e.g. preview) — just show defaults, no persistence.
      if (!userEmail) return useDefaults(false);

      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .eq('user_email', userEmail)
        .order('sort_order', { ascending: true });

      if (error) {
        // Table likely not created yet — degrade gracefully to in-memory mode.
        console.warn('[SkillFactory] subagents table unavailable:', error.message);
        return useDefaults(false);
      }

      if (data && data.length > 0) {
        if (cancelled) return;
        const list = (data as SubagentRow[]).map(rowToSubagent);
        setSubagents(list);
        setActiveId(list[0].id);
        setPersist(true);
        setLoadingAgents(false);
        return;
      }

      // First visit for this user: seed the default subagents into their account.
      const seedRows = DEFAULT_SUBAGENTS.map((s, i) => ({
        user_email: userEmail,
        name: s.name,
        description: s.description,
        icon: s.icon,
        rules: s.rules,
        workflow: s.workflow,
        sort_order: i,
      }));
      const { data: inserted, error: seedErr } = await supabase
        .from(TABLE)
        .insert(seedRows)
        .select('*');

      if (seedErr || !inserted) {
        console.warn('[SkillFactory] could not seed defaults:', seedErr?.message);
        return useDefaults(false);
      }
      if (cancelled) return;
      const list = (inserted as SubagentRow[]).map(rowToSubagent);
      setSubagents(list);
      setActiveId(list[0]?.id ?? '');
      setPersist(true);
      setLoadingAgents(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [userEmail]);

  // Keep a valid rule selected. Preserves an explicit selection (e.g. a rule the
  // user/AI just added) and only falls back to the first rule when the current
  // one no longer belongs to the active subagent (e.g. after switching subagents).
  useEffect(() => {
    setActiveRuleId((cur) =>
      active?.rules.some((r) => r.id === cur) ? cur : active?.rules[0]?.id ?? '',
    );
  }, [activeId, active]);

  // Rebuild the editable rows from the SELECTED RULE's workflow.
  useEffect(() => {
    if (!activeRule) {
      setRows([]);
      return;
    }
    setRows(
      activeRule.workflow.map((n, i) => ({
        id: `${activeRule.id}-${i}`,
        label: n.label,
        type: n.type,
        assignee: UNASSIGNED,
      })),
    );
  }, [activeRule]);

  // ── Create a new subagent (the "+" in the Subagents header) ──
  const addSubagent = async () => {
    const name = window.prompt('New subagent name:')?.trim();
    if (!name) return;
    const description = window.prompt('Short description (optional):')?.trim() || 'Custom subagent';

    if (persist && userEmail) {
      const { data, error } = await supabase
        .from(TABLE)
        .insert({
          user_email: userEmail,
          name,
          description,
          icon: 'box',
          rules: [],
          workflow: [],
          sort_order: subagents.length,
        })
        .select('*')
        .single();
      if (error || !data) {
        toast.error('Could not save the subagent.');
        return;
      }
      const created = rowToSubagent(data as SubagentRow);
      setSubagents((prev) => [...prev, created]);
      setActiveId(created.id);
      toast.success(`Subagent "${name}" created.`);
    } else {
      const created: Subagent = {
        id: `local-${Date.now()}`,
        name,
        description,
        icon: 'box',
        rules: [],
        workflow: [],
      };
      setSubagents((prev) => [...prev, created]);
      setActiveId(created.id);
    }
  };

  // ── Add a rule to the active subagent (the "+" in the Rules header) ──
  const addRule = async () => {
    if (!active) return;
    const trigger = window.prompt('Rule trigger (e.g. "Photo C"):')?.trim();
    if (!trigger) return;
    const action = window.prompt('Maps to (e.g. "Consent form"):')?.trim();
    if (!action) return;

    const rule: Rule = { id: crypto.randomUUID(), trigger, action, workflow: [] };
    const nextRules = [...active.rules, rule];

    // Optimistic local update; select the new rule so its (empty) workflow shows.
    setSubagents((prev) =>
      prev.map((s) => (s.id === active.id ? { ...s, rules: nextRules } : s)),
    );
    setActiveRuleId(rule.id);

    if (persist && !active.id.startsWith('local-')) {
      const { error } = await supabase
        .from(TABLE)
        .update({ rules: nextRules })
        .eq('id', active.id);
      if (error) toast.error('Could not save the rule.');
    }
  };

  // Persist the full rules array for the active subagent (shared by AI apply,
  // drag-reorder, etc.). In-memory only when not persisting.
  const persistRules = async (nextRules: Rule[]) => {
    if (!active) return;
    setSubagents((prev) =>
      prev.map((s) => (s.id === active.id ? { ...s, rules: nextRules } : s)),
    );
    if (persist && !active.id.startsWith('local-')) {
      const { error } = await supabase
        .from(TABLE)
        .update({ rules: nextRules })
        .eq('id', active.id);
      if (error) toast.error('Could not save changes.');
    }
  };

  // Write a new workflow onto the active rule (used by drag-reorder + AI apply).
  const saveRuleWorkflow = async (ruleId: string, workflow: WorkflowNode[]) => {
    if (!active) return;
    const nextRules = active.rules.map((r) =>
      r.id === ruleId ? { ...r, workflow } : r,
    );
    await persistRules(nextRules);
  };

  // ── Delete a subagent (trash icon on each subagent card) ──
  const deleteSubagent = async (id: string) => {
    const s = subagents.find((x) => x.id === id);
    if (!s) return;
    if (!window.confirm(`Delete subagent "${s.name}" and all its rules?`)) return;

    const next = subagents.filter((x) => x.id !== id);
    setSubagents(next);
    if (activeId === id) setActiveId(next[0]?.id ?? '');

    // default-/local- ids only ever exist in memory, never in the DB.
    if (persist && !id.startsWith('local-') && !id.startsWith('default-')) {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) toast.error('Could not delete the subagent.');
    }
  };

  // ── Delete a rule (trash icon on each rule card) ──
  const deleteRule = async (ruleId: string) => {
    if (!active) return;
    const r = active.rules.find((x) => x.id === ruleId);
    if (!r) return;
    if (!window.confirm(`Delete rule "${r.trigger} → ${r.action}" and its workflow?`)) return;

    const nextRules = active.rules.filter((x) => x.id !== ruleId);
    if (activeRuleId === ruleId) setActiveRuleId(nextRules[0]?.id ?? '');
    await persistRules(nextRules);
  };

  // ── Delete one workflow step from the active rule ──
  const deleteStep = (index: number) => {
    if (!activeRule) return;
    const nextWf = activeRule.workflow.filter((_, i) => i !== index);
    void saveRuleWorkflow(activeRule.id, nextWf);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id || !activeRule) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === dragged.id);
      const to = prev.findIndex((r) => r.id === over.id);
      const next = arrayMove(prev, from, to);
      // Persist the new step order onto the active rule's workflow.
      void saveRuleWorkflow(
        activeRule.id,
        next.map((r) => ({ label: r.label, type: r.type })),
      );
      return next;
    });
  };

  const setAssignee = (id: string, assignee: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, assignee } : r)));
  };

  // Add a new person (used by a row's "Add new person…" option) and assign it.
  const addPerson = (id: string) => {
    const name = window.prompt('New person name:')?.trim();
    if (!name) return;
    setPeople((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setAssignee(id, name);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Apply a workflow the AI committed: either onto the active rule, or split the
  // work into several smaller rules ("skills"). Auto-saves. Returns a one-line
  // confirmation for the chat.
  const applySkill = async (parsed: ParsedSkill): Promise<string> => {
    if (!active) return 'No subagent selected.';

    if (parsed.kind === 'workflow') {
      if (activeRule) {
        await saveRuleWorkflow(activeRule.id, parsed.workflow);
        return `Saved a ${parsed.workflow.length}-step workflow to "${activeRule.trigger} → ${activeRule.action}".`;
      }
      const last = parsed.workflow[parsed.workflow.length - 1];
      const created: Rule = {
        id: crypto.randomUUID(),
        trigger: 'New task',
        action: last?.label ?? 'Workflow',
        workflow: parsed.workflow,
      };
      await persistRules([...active.rules, created]);
      setActiveRuleId(created.id);
      return `Created a new rule with a ${parsed.workflow.length}-step workflow.`;
    }

    // breakdown: split into multiple smaller rules, de-duping triggers.
    const used = new Set<string>();
    active.rules.forEach((r) => {
      if (!activeRule || r.id !== activeRule.id) used.add(r.trigger.toLowerCase());
    });
    const uniqueTrigger = (t: string) => {
      let candidate = t;
      let n = 2;
      while (used.has(candidate.toLowerCase())) candidate = `${t} (${n++})`;
      used.add(candidate.toLowerCase());
      return candidate;
    };
    const built: Rule[] = parsed.rules.map((br, i) => ({
      id: i === 0 && activeRule ? activeRule.id : crypto.randomUUID(),
      trigger: uniqueTrigger(br.trigger),
      action: br.action,
      workflow: br.workflow,
    }));

    const nextRules = activeRule
      ? [...active.rules.map((r) => (r.id === activeRule.id ? built[0] : r)), ...built.slice(1)]
      : [...active.rules, ...built];
    await persistRules(nextRules);
    setActiveRuleId(built[0].id);
    const names = built.map((r) => `"${r.trigger} → ${r.action}"`).join(', ');
    return `Split into ${built.length} skill${built.length > 1 ? 's' : ''}: ${names} — all saved.`;
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !active) return;

    if (!GEMINI_KEY) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'AI is not configured. Please set VITE_GEMINI_API_KEY.' },
      ]);
      return;
    }

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setLoading(true);

    try {
      // Gemini uses "model" for the assistant role and carries the system
      // prompt in a dedicated systemInstruction field (not the contents array).
      const res = await geminiFetch(geminiGenerateContentUrl(GEMINI_KEY), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: buildHeadOfHospitalPrompt(active, activeRule) }] },
          contents: [
            ...messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            { role: 'user', parts: [{ text: trimmed }] },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 800 },
        }),
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';

      // Split the reply into prose (shown) and an optional committed workflow.
      const { display, payload } = extractSkillBlock(reply);
      const parsed = payload ? validateSkill(payload) : null;
      if (display) {
        setMessages((prev) => [...prev, { role: 'assistant', content: display }]);
      } else if (!parsed) {
        setMessages((prev) => [...prev, { role: 'assistant', content: reply || 'No response.' }]);
      }
      if (parsed) {
        const note = await applySkill(parsed);
        setMessages((prev) => [...prev, { role: 'assistant', content: note }]);
        toast.success(note);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection error. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-gray-50 relative">
      {/* ── Always-visible Open-Dashboard FAB (bottom-right, fixed to the page) ── */}
      <button
        onClick={() => navigate('/deadline-tracking')}
        title="Open the live Deadline Tracking dashboard (the automation we built)"
        className="fixed bottom-6 right-6 z-50 flex items-center gap-2 text-sm px-4 py-3 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-2xl ring-4 ring-emerald-300/50 animate-pulse"
      >
        <CheckCircle2 className="w-5 h-5" />
        <span className="font-semibold">Deadline Automation</span>
        <span className="opacity-90">— Open Dashboard</span>
        <ExternalLink className="w-4 h-4 opacity-90" />
      </button>

      {/* ── Skill Factory rail ── */}
      <aside className="w-52 shrink-0 border-r border-gray-200 bg-white flex flex-col">
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-semibold text-gray-900">Skill Factory</span>
          </div>
          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tabs..."
              className="w-full text-xs pl-8 pr-2 py-1.5 rounded-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            />
          </div>
        </div>
        <nav className="p-2 space-y-0.5">
          <div className="flex items-center gap-2 px-2 py-2 text-xs text-gray-500">
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-semibold">
              IS
            </div>
            ionali
          </div>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setActiveNav(n.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors ${
                activeNav === n.id
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <n.icon className="w-4 h-4" />
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      {activeNav === 'subagents' ? (
        <>
          {/* ── Subagents column ── */}
          <section className="w-60 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Subagents
              </h2>
              <button
                onClick={addSubagent}
                title="Add subagent"
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="px-2 space-y-1">
              {loadingAgents && (
                <p className="px-3 py-4 text-xs text-gray-400">Loading…</p>
              )}
              {!loadingAgents &&
                filtered.map((s) => {
                  const Icon = iconFor(s.icon);
                  return (
                    <div key={s.id} className="relative group">
                      <button
                        onClick={() => setActiveId(s.id)}
                        className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                          activeId === s.id
                            ? 'border-blue-300 bg-blue-50'
                            : 'border-transparent hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 pr-5">
                          <Icon className={`w-4 h-4 ${activeId === s.id ? 'text-blue-600' : 'text-gray-400'}`} />
                          <span className="text-sm font-medium text-gray-900">{s.name}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 pl-6">{s.description}</p>
                      </button>
                      <button
                        onClick={() => deleteSubagent(s.id)}
                        title="Delete subagent"
                        className="absolute top-2 right-2 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              {!loadingAgents && subagents.length === 0 && (
                <p className="px-3 py-4 text-xs text-gray-400">
                  No subagents yet. Click <span className="font-medium">Add</span> to create one.
                </p>
              )}
              {!loadingAgents && subagents.length > 0 && filtered.length === 0 && (
                <p className="px-3 py-4 text-xs text-gray-400">No subagents match.</p>
              )}
            </div>
          </section>

          {/* ── Rules column ── */}
          <section className="w-56 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Rules
              </h2>
              <button
                onClick={addRule}
                disabled={!active}
                title="Add rule"
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="px-3 space-y-2">
              {active?.rules.map((r) => (
                <div key={r.id} className="relative group">
                  <button
                    onClick={() => setActiveRuleId(r.id)}
                    className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors ${
                      activeRuleId === r.id
                        ? 'border-blue-300 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-sm text-gray-900 pr-5">
                      <Camera className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="font-medium">{r.trigger}</span>
                      <span className="text-gray-400">→</span>
                      <span className="truncate">{r.action}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 pl-5">
                      {r.workflow.length > 0 ? `${r.workflow.length} step${r.workflow.length > 1 ? 's' : ''}` : 'no workflow yet'}
                    </p>
                  </button>
                  <button
                    onClick={() => deleteRule(r.id)}
                    title="Delete rule"
                    className="absolute top-2 right-2 p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {active && active.rules.length === 0 && (
                <p className="px-1 py-3 text-xs text-gray-400">
                  No rules yet. Click <span className="font-medium">Add</span> to map a photo to a document.
                </p>
              )}
            </div>
          </section>

          {/* ── Workflow column (belongs to the selected rule) ── */}
          <section className="flex-1 min-w-0 bg-gray-50 overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 truncate">
                Workflow
                {activeRule && (
                  <span className="ml-2 normal-case font-normal text-gray-500">
                    · {activeRule.trigger} → {activeRule.action}
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-2 shrink-0">
                <button className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                  <Play className="w-3 h-3" /> Execute
                </button>
                <button className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-white transition-colors">
                  <BarChart3 className="w-3 h-3" /> Insights
                </button>
              </div>
            </div>

            {!activeRule && (
              <p className="px-5 py-8 text-sm text-gray-400 text-center">
                Select a rule on the left to see or build its workflow.
              </p>
            )}

            {activeRule && rows.length === 0 && (
              <div className="px-5 py-8 text-center">
                <p className="text-sm text-gray-500">This rule has no workflow yet.</p>
                <p className="text-xs text-gray-400 mt-1">
                  Ask the AI Assistant on the right to design it — it'll break the task into simple, automatable steps.
                </p>
              </div>
            )}

            {activeRule && rows.length > 0 && (
              <>
                <p className="px-5 pb-2 text-xs text-gray-400">
                  Drag rows to reorder. Assign a person to each step.
                </p>
                <div className="px-4 pb-6 max-w-2xl">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {rows.map((row, i) => (
                          <WorkflowRowView
                            key={row.id}
                            row={row}
                            index={i}
                            people={people}
                            onAssign={(v) => setAssignee(row.id, v)}
                            onAddPerson={() => addPerson(row.id)}
                            onDelete={() => deleteStep(i)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </>
            )}
          </section>
        </>
      ) : (
        <section className="flex-1 min-w-0 bg-gray-50 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <GitBranch className="w-8 h-8 mx-auto mb-2" />
            <p className="text-sm capitalize">{activeNav} — coming soon</p>
          </div>
        </section>
      )}

      {/* ── AI Assistant panel (Gemini) ── */}
      <aside className="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 shrink-0">
          <Bot className="w-4 h-4 text-blue-600" />
          <span className="text-sm font-semibold text-gray-900">AI Assistant</span>
          <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
            Gemini
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                I'm your <span className="font-medium">Head of Hospital</span>. Tell me what should happen for
                {activeRule ? ` "${activeRule.trigger} → ${activeRule.action}"` : ' the selected rule'} and I'll design a simple, automatable workflow — splitting it into smaller skills if it gets too complex.
              </p>
              {[
                `Design the workflow for "${activeRule?.trigger ?? 'this rule'}"`,
                'This task feels big — break it into smaller skills',
                'What do you need to know to build this workflow?',
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-3 h-3 text-blue-400" />
                </div>
              )}
              <div
                className={`max-w-[85%] text-xs px-3 py-2 rounded-lg leading-relaxed whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-none'
                    : 'bg-gray-50 text-gray-900 border border-gray-200 rounded-bl-none'
                }`}
              >
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="w-6 h-6 rounded-full bg-gray-900 flex items-center justify-center shrink-0">
                <Bot className="w-3 h-3 text-blue-400" />
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-lg rounded-bl-none px-3 py-2">
                <div className="flex gap-1 items-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 shrink-0">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask the assistant..."
            className="flex-1 text-xs px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    </div>
  );
}

// Per-row coloured dot so step / decision / output stay visually distinct
// even though every node is now a uniform draggable row.
const TYPE_DOT: Record<WorkflowNode['type'], string> = {
  step: 'bg-gray-400',
  decision: 'bg-amber-400',
  output: 'bg-green-500',
};

const ADD_PERSON = '__add__';

// One draggable workflow row: drag handle + step name + person selector.
function WorkflowRowView({
  row,
  index,
  people,
  onAssign,
  onAddPerson,
  onDelete,
}: {
  row: WorkflowRow;
  index: number;
  people: string[];
  onAssign: (value: string) => void;
  onAddPerson: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2.5 shadow-sm"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 shrink-0 mt-0.5"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Row 1 — step name */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 shrink-0">{index + 1}</span>
          <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_DOT[row.type]}`} />
          <span className="text-sm font-medium text-gray-900 truncate flex-1">{row.label}</span>
          <button
            onClick={onDelete}
            title="Delete step"
            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Row 2 — changeable / selectable person (with add-new) */}
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <select
            value={row.assignee}
            onChange={(e) => {
              if (e.target.value === ADD_PERSON) onAddPerson();
              else onAssign(e.target.value);
            }}
            className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Unassigned</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value={ADD_PERSON}>+ Add new person…</option>
          </select>
          <button
            onClick={onAddPerson}
            title="Add new person"
            className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 shrink-0"
          >
            <UserPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
