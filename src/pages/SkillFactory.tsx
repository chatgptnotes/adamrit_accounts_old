import { useState, useRef, useEffect } from 'react';
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

// ── Skill Factory data ──────────────────────────────────────────────────────
// Each subagent bundles the rules that feed it and the workflow it produces.
// This lives in code (not the DB) so the page works standalone; the AI
// Assistant on the right is the live, Gemini-powered part.

interface Rule {
  id: string;
  trigger: string; // e.g. "Photo A"
  action: string; // e.g. "Admission note"
}

interface WorkflowNode {
  label: string;
  type: 'step' | 'decision' | 'output';
}

interface Subagent {
  id: string;
  name: string;
  description: string;
  icon: typeof FileText;
  rules: Rule[];
  workflow: WorkflowNode[];
}

const SUBAGENTS: Subagent[] = [
  {
    id: 'discharge',
    name: 'Discharge',
    description: 'Discharge document agent',
    icon: FileText,
    rules: [
      { id: 'r1', trigger: 'Photo A', action: 'Admission note' },
      { id: 'r2', trigger: 'Photo B', action: "Doctor's discharge note" },
    ],
    workflow: [
      { label: 'Admission note', type: 'step' },
      { label: "Doctor's Discharge note", type: 'step' },
      { label: 'Discharge approval', type: 'decision' },
      { label: 'Generate discharge summary', type: 'output' },
    ],
  },
  {
    id: 'ipd-registration',
    name: 'IPD Registration',
    description: 'Admission intake agent',
    icon: ClipboardList,
    rules: [
      { id: 'r1', trigger: 'Photo A', action: 'Aadhaar / ID card' },
      { id: 'r2', trigger: 'Photo B', action: 'Referral letter' },
    ],
    workflow: [
      { label: 'Capture ID', type: 'step' },
      { label: 'Verify patient', type: 'decision' },
      { label: 'Create IPD visit', type: 'output' },
    ],
  },
  {
    id: 'lab-orders',
    name: 'Lab Orders',
    description: 'Diagnostics & reports agent',
    icon: TestTube,
    rules: [
      { id: 'r1', trigger: 'Photo A', action: 'Doctor order sheet' },
    ],
    workflow: [
      { label: 'Read order sheet', type: 'step' },
      { label: 'Map to lab tests', type: 'step' },
      { label: 'Create lab order', type: 'output' },
    ],
  },
  {
    id: 'pharmacy',
    name: 'Pharmacy',
    description: 'Dispense & inventory agent',
    icon: Pill,
    rules: [
      { id: 'r1', trigger: 'Photo A', action: 'Prescription' },
    ],
    workflow: [
      { label: 'Read prescription', type: 'step' },
      { label: 'Check stock', type: 'decision' },
      { label: 'Create sale bill', type: 'output' },
    ],
  },
  {
    id: 'radiology',
    name: 'Radiology',
    description: 'Imaging agent',
    icon: Camera,
    rules: [
      { id: 'r1', trigger: 'Photo A', action: 'Imaging request' },
    ],
    workflow: [
      { label: 'Read request', type: 'step' },
      { label: 'Schedule scan', type: 'output' },
    ],
  },
];

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

function buildSystemPrompt(agent: Subagent): string {
  const rules = agent.rules.map((r) => `${r.trigger} → ${r.action}`).join('; ');
  const flow = agent.workflow.map((n) => n.label).join(' → ');
  return `You are the AI Assistant inside "Skill Factory", a no-code builder where hospital staff at Hope Hospital and Ayushman Hospital (Nagpur, India) create "subagents" that automate paperwork from photos.

The user is currently editing the "${agent.name}" subagent.
- Its rules map uploaded photos to documents: ${rules || 'none yet'}.
- Its workflow is: ${flow}.

Help the user understand, improve, and extend this subagent — explain what the workflow does, suggest new rules or steps, and describe each node in plain language. Be concise and practical for a hospital setting. When useful, refer to the steps and rules above by name.`;
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
  const [activeNav, setActiveNav] = useState<(typeof NAV)[number]['id']>('subagents');
  const [activeId, setActiveId] = useState(SUBAGENTS[0].id);
  const [search, setSearch] = useState('');

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

  const active = SUBAGENTS.find((s) => s.id === activeId) ?? SUBAGENTS[0];
  const filtered = SUBAGENTS.filter((s) =>
    s.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  // Rebuild the editable rows whenever a different subagent is selected.
  useEffect(() => {
    setRows(
      active.workflow.map((n, i) => ({
        id: `${active.id}-${i}`,
        label: n.label,
        type: n.type,
        assignee: UNASSIGNED,
      })),
    );
  }, [active]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === dragged.id);
      const to = prev.findIndex((r) => r.id === over.id);
      return arrayMove(prev, from, to);
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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

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
          systemInstruction: { parts: [{ text: buildSystemPrompt(active) }] },
          contents: [
            ...messages.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
            { role: 'user', parts: [{ text: trimmed }] },
          ],
          generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
        }),
      });
      const data = await res.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
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
    <div className="flex h-full min-h-0 bg-gray-50">
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
            <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Subagents
            </h2>
            <div className="px-2 space-y-1">
              {filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                    activeId === s.id
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <s.icon className={`w-4 h-4 ${activeId === s.id ? 'text-blue-600' : 'text-gray-400'}`} />
                    <span className="text-sm font-medium text-gray-900">{s.name}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 pl-6">{s.description}</p>
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-4 text-xs text-gray-400">No subagents match.</p>
              )}
            </div>
          </section>

          {/* ── Rules column ── */}
          <section className="w-56 shrink-0 border-r border-gray-200 bg-white overflow-y-auto">
            <h2 className="px-4 pt-4 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
              Rules
            </h2>
            <div className="px-3 space-y-2">
              {active.rules.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border border-gray-200 px-3 py-2.5 bg-gray-50"
                >
                  <div className="flex items-center gap-1.5 text-sm text-gray-900">
                    <Camera className="w-3.5 h-3.5 text-gray-400" />
                    <span className="font-medium">{r.trigger}</span>
                    <span className="text-gray-400">→</span>
                    <span>{r.action}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Workflow column ── */}
          <section className="flex-1 min-w-0 bg-gray-50 overflow-y-auto">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Workflow
              </h2>
              <div className="flex items-center gap-2">
                <button className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors">
                  <Play className="w-3 h-3" /> Execute
                </button>
                <button className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-white transition-colors">
                  <BarChart3 className="w-3 h-3" /> Insights
                </button>
              </div>
            </div>

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
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
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
                Ask me about the <span className="font-medium">{active.name}</span> subagent — what it
                does, or how to add rules and steps.
              </p>
              {[
                `Explain the ${active.name} workflow`,
                'When is Photo A uploaded?',
                'Suggest one more rule for this agent',
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
}: {
  row: WorkflowRow;
  index: number;
  people: string[];
  onAssign: (value: string) => void;
  onAddPerson: () => void;
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
          <span className="text-sm font-medium text-gray-900 truncate">{row.label}</span>
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
